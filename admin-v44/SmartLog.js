// SmartLog.js (v49.1) - Await Auth Before Firestore Write
// מודול לוגים חכם הכותב ל-Firestore, עם תמיכה בקטגוריה והצעה לפתרון

// v49.1: Import authReady promise
import { db, auth, authReady as authReadyPromise } from './config.js';
import { collection, addDoc, serverTimestamp } from "[https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js](https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js)";

const LOG_COLLECTION = 'system_logs_v3';
const sessionId = (Date.now() + Math.random()).toString(36);
let isDbAvailable = !!db;
let authChecked = false; // v49.1: Flag to avoid awaiting multiple times unnecessarily

// פונקציה פנימית לכתיבת הלוג
const writeLog = async (level, message, origin, context = {}, category = null, solution = null) => { // v49.1: Made async
    // Log to console immediately
    const consoleArgs = [`[${origin}] ${level}:`, message];
    if (Object.keys(context).length > 0) consoleArgs.push(context);
    if (category) consoleArgs.push(`[Category: ${category}]`);
    if (solution) consoleArgs.push(`[Solution: ${solution}]`);
    switch (level) { case 'INFO': console.log(...consoleArgs); break; case 'WARN': console.warn(...consoleArgs); break; case 'ERROR': console.error(...consoleArgs); break; default: console.log(...consoleArgs); }

    // Attempt to write to Firestore only if db is available AND auth is ready
    if (!isDbAvailable) { console.warn("SmartLog: Firestore DB instance unavailable.", { level, message, origin }); return; }

    try {
        // v49.1: Wait for authentication ONLY if not checked before or if auth object is missing initially
        if (!authChecked || !auth?.currentUser) {
            console.log("SmartLog: Waiting for authReadyPromise before writing to Firestore...");
            await authReadyPromise; // Wait for the auth process (including retries) to complete
            authChecked = true; // Mark as checked for this session
            console.log("SmartLog: Auth is ready. Proceeding with Firestore write.");
        }

        const user = auth?.currentUser; // Use optional chaining again after await
        if (!user) {
             // This should ideally not happen if authReadyPromise resolved, but as a safeguard
             console.warn("SmartLog: User object not available even after authReady. Log not sent to Firestore.", { level, message, origin });
             return;
        }
        const userContext = { uid: user.uid, isAnonymous: user.isAnonymous };

        const logEntry = {
            timestamp: serverTimestamp(), level, message: String(message), origin,
            context: { ...JSON.parse(JSON.stringify(context || {})), sessionId, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A', page: typeof window !== 'undefined' ? window.location.pathname : 'N/A' },
            user: userContext, category: category || null, solution: solution || null
        };

        await addDoc(collection(db, LOG_COLLECTION), logEntry);
        // console.log("SmartLog: Log entry written to Firestore."); // Optional: log success

    } catch (error) {
        // Log the failure to write the log itself
        console.error("SmartLog FATAL ERROR: Failed to write log entry to Firestore.", error, { originalMessage: message });
        // Set flag to prevent future Firestore write attempts if permission error occurs?
        if (error.code === 'permission-denied' || error.message.includes('permissions')) {
             console.warn("SmartLog: Disabling further Firestore logging due to permission error.");
             isDbAvailable = false; // Prevent further attempts if permissions are wrong
        }
    }
};

// ממשק חיצוני (no changes needed here)
const SmartLog = {
    info: (message, origin, context = {}) => { writeLog('INFO', message, origin, context); },
    warn: (message, origin, context = {}, category = null, solution = null) => { writeLog('WARN', message, origin, context, category, solution); },
    error: (error, origin, context = {}, category = null, solution = null) => { const message = error instanceof Error ? error.message : String(error); const stack = error instanceof Error ? error.stack : 'No stack trace available'; writeLog('ERROR', message, origin, { ...context, stack }, category, solution); }
};

export { SmartLog };

