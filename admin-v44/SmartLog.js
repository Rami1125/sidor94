// SmartLog.js (v49.2) - Ensure page context for better filtering
// מודול לוגים חכם הכותב ל-Firestore, עם תמיכה בקטגוריה והצעה לפתרון

// v49.1: Import authReady promise
import { db, auth, authReady as authReadyPromise } from './config.js'; // Assuming config.js is v47.7+
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

const LOG_COLLECTION = 'system_logs_v3';
const sessionId = (Date.now() + Math.random()).toString(36);
let isDbAvailable = !!db;
let authChecked = false;

// פונקציה פנימית לכתיבת הלוג
const writeLog = async (level, message, origin, context = {}, category = null, solution = null) => {
    // Log to console immediately
    const consoleArgs = [`[${origin}] ${level}:`, message];
    // v49.2: Clean context before logging to console to avoid potential circular references or large objects
    const safeContext = {};
    for (const key in context) {
        if (Object.hasOwnProperty.call(context, key)) {
            const value = context[key];
            // Avoid logging overly complex objects to console by default, stringify small parts if needed
            if (typeof value === 'object' && value !== null) {
                try {
                    // Try to stringify, limit length
                    const strValue = JSON.stringify(value);
                    safeContext[key] = strValue.length > 100 ? strValue.substring(0, 100) + '...' : strValue;
                } catch (e) {
                    safeContext[key] = '[Unserializable Object]';
                }
            } else {
                safeContext[key] = value;
            }
        }
    }
    if (Object.keys(safeContext).length > 0) consoleArgs.push(safeContext);
    if (category) consoleArgs.push(`[Cat: ${category}]`);
    if (solution) consoleArgs.push(`[Sol: ${solution}]`);
    switch (level) { case 'INFO': console.log(...consoleArgs); break; case 'WARN': console.warn(...consoleArgs); break; case 'ERROR': console.error(...consoleArgs); break; default: console.log(...consoleArgs); }

    if (!isDbAvailable) { /* console.warn("SmartLog: DB unavailable."); */ return; }

    try {
        if (!authChecked || !auth?.currentUser) { await authReadyPromise; authChecked = true; }
        const user = auth?.currentUser; if (!user) { return; } // Don't log to DB if auth failed
        const userContext = { uid: user.uid, isAnonymous: user.isAnonymous };

        // v49.2: Ensure page context is always included and cleaned
        const pagePath = typeof window !== 'undefined' ? window.location.pathname : 'N/A';
        // Simple cleaning: remove leading/trailing slashes and potentially hash/query params
        const cleanPageName = pagePath.replace(/^\/+|\/+$/g, '').split(/[?#]/)[0] || 'unknown';

        const finalContext = {
             // Stringify context again for Firestore to handle potential non-serializable values gracefully
             ...JSON.parse(JSON.stringify(context || {})),
             sessionId,
             userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
             page: pagePath, // Send full path
             // pageName: cleanPageName // Or send cleaned name if preferred
        };


        const logEntry = {
            timestamp: serverTimestamp(), level, message: String(message), origin,
            context: finalContext, // Use the final cleaned context
            user: userContext, category: category || null, solution: solution || null
        };

        await addDoc(collection(db, LOG_COLLECTION), logEntry);

    } catch (error) {
        console.error("SmartLog FATAL ERROR writing to Firestore.", error, { originalMessage: message });
        if (error.code === 'permission-denied' || error.message.includes('permissions')) { console.warn("SmartLog: Disabling Firestore logging."); isDbAvailable = false; }
    }
};

// ממשק חיצוני (no changes needed here)
const SmartLog = {
    info: (message, origin, context = {}) => { writeLog('INFO', message, origin, context); },
    warn: (message, origin, context = {}, category = null, solution = null) => { writeLog('WARN', message, origin, context, category, solution); },
    error: (error, origin, context = {}, category = null, solution = null) => { const message = error instanceof Error ? error.message : String(error); const stack = error instanceof Error ? error.stack : 'No stack trace available'; writeLog('ERROR', message, origin, { ...context, stack }, category, solution); }
};

export { SmartLog };

