/**
 * DeliveryMaster Proxy Server v31.5
 *
 * This server acts as an intelligent middle-layer between the
 * client applications (admin, log, etc.) and the Google Apps Script backend.
 *
 * It solves all CORS issues, provides robust logging, and adds a retry mechanism.
 */

import express from "express";
import fetch from "node-fetch"; // Make sure to install: npm i node-fetch
import cors from "cors"; // npm i cors
import fs from "fs";
import path from "path";

// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 8080;
// The Google Apps Script URL (from your prompt history, v31.3)
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyGQ9NJhoY--Fl07JOtfIZKS1dS4Ujzeirf-lDcGYY9XM0ItOCgJItMwit5rIiSge_u/exec";
const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "system.log");
const RETRY_ATTEMPTS = 3;
const HEALTH_CHECK_INTERVAL = 1000 * 60 * 60; // 1 hour

// --- PROXY SETUP ---
app.use(cors()); // Enable CORS for all requests from your client
app.use(express.json()); // Parse JSON bodies

// --- v31.5: Smart Logger Utility ---
const smartLog = (level, message, context = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message} | Context: ${JSON.stringify(context)}\n`;

    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR);
    }

    // Append to local log file
    fs.appendFile(LOG_FILE, logEntry, (err) => {
        if (err) console.error("Failed to write to local log:", err);
    });

    // Also log to console
    console.log(logEntry.trim());
};

// --- v31.5: Auto-Retry Utility ---
const retryFetch = async (url, options, attempt = 1) => {
    try {
        const response = await fetch(url, options);
        if (!response.ok && response.status !== 500) { // 500 might be a script error we want to see
             smartLog("WARN", `Fetch attempt ${attempt} failed with status ${response.status}`, { url, status: response.status });
             throw new Error(`HTTP error ${response.status}`);
        }
        return response;
    } catch (err) {
        if (attempt >= RETRY_ATTEMPTS) {
            smartLog("ERROR", `All fetch attempts failed for ${url}`, { error: err.message, attempt });
            throw err;
        }
        smartLog("INFO", `Retrying fetch for ${url} (Attempt ${attempt + 1})...`, { error: err.message });
        // Exponential backoff
        await new Promise(res => setTimeout(res, 1000 * attempt));
        return retryFetch(url, options, attempt + 1);
    }
};

// --- API ROUTES (Matching Client) ---

// Handle GET requests (e.g., /api/getDashboardData)
app.get("/api/:action", async (req, res) => {
    const action = req.params.action;
    const queryParams = new URLSearchParams(req.query).toString();
    const targetUrl = `${GAS_API_URL}?action=${action}&${queryParams}`;

    smartLog("INFO", `Proxying GET request`, { action });

    try {
        const response = await retryFetch(targetUrl, { method: "GET" });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        smartLog("ERROR", `Proxy GET request failed`, { action, error: err.message });
        res.status(502).json({ status: "error", data: "Proxy GET failed", details: err.message });
    }
});

// Handle POST requests (e.g., /api/createNewOrder)
app.post("/api/:action", async (req, res) => {
    const action = req.params.action;
    const targetUrl = GAS_API_URL; // GAS handles action from the *body* for POST

    smartLog("INFO", `Proxying POST request`, { action });

    // Re-wrap the body to match what Code.gs (v31.4) expects
    const proxyBody = {
        action: action,
        // For batch logs, the body is the array. For others, it's an object { data: ... }
        // The client (v31.5) sends the payload directly, so we re-wrap it here.
        data: (action === 'logToServerBatch') ? req.body : req.body 
    };

    const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // v31.5 Client (admin-app) sends POST data differently
        // logToServerBatch sends an array
        // createNewOrder sends { orderData, customerData }
        // assignDriver sends { orderId, driverId }
        // We must adapt. The proxy should send what the *client* sends.
        body: (action === 'logToServerBatch') ? 
                JSON.stringify({ action: 'logToServerBatch', data: { logs: req.body } }) : 
                JSON.stringify({ action: action, data: req.body }),
    };

    try {
        const response = await retryFetch(targetUrl, options);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        smartLog("ERROR", `Proxy POST request failed`, { action, error: err.message });
        res.status(502).json({ status: "error", data: "Proxy POST failed", details: err.message });
    }
});

// --- v31.5: Health Check ---
const runHealthCheck = async () => {
    smartLog("INFO", "Running hourly health check...");
    try {
        // We ping a simple GET endpoint as a health check
        const res = await fetch(`${GAS_API_URL}?action=getDrivers`);
        if (!res.ok) {
           throw new Error(`Health check failed with status: ${res.status}`);
        }
        const data = await res.json();
        if (data.status === 'success') {
             smartLog("INFO", "Health check OK. Google Apps Script is responsive.", { status: data.status });
        } else {
             throw new Error(`Health check failed: ${data.data}`);
        }
    } catch (err) {
        smartLog("FATAL", "HEALTH CHECK FAILED. Google Apps Script may be down or has invalid CORS.", { error:
