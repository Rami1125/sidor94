// SmartLog.js (v49.0) - Watchdog Mode
// מודול לוגים חכם הכותב ל-Firestore, עם תמיכה בקטגוריה והצעה לפתרון

import { db, auth } from './config.js'; // Assuming config provides initialized db and auth
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

const LOG_COLLECTION = 'system_logs_v3'; // Use the same collection for now
const sessionId = (Date.now() + Math.random()).toString(36);
let isDbAvailable = !!db; // Check if db was initialized successfully in config

// פונקציה פנימית לכתיבת הלוג
const writeLog = async (level, message, origin, context = {}, category = null, solution = null) => { // v49.0: Added category, solution
    // Log to console immediately regardless of DB status
    const consoleArgs = [`[${origin}] ${level}:`, message];
    if (Object.keys(context).length > 0) consoleArgs.push(context);
    if (category) consoleArgs.push(`[Category: ${category}]`);
    if (solution) consoleArgs.push(`[Solution: ${solution}]`);

    switch (level) {
        case 'INFO': console.log(...consoleArgs); break;
        case 'WARN': console.warn(...consoleArgs); break;
        case 'ERROR': console.error(...consoleArgs); break;
        default: console.log(...consoleArgs);
    }

    // Attempt to write to Firestore only if db is available
    if (!isDbAvailable) {
        console.warn("SmartLog: Firestore DB instance is not available. Log not sent to server.", { level, message, origin });
        return;
    }

    try {
        const user = auth?.currentUser; // Use optional chaining
        const userContext = user ? { uid: user.uid, isAnonymous: user.isAnonymous } : { uid: 'unknown' };

        const logEntry = {
            timestamp: serverTimestamp(),
            level, // 'INFO', 'WARN', 'ERROR'
            message: String(message), // Ensure message is a string
            origin, // 'AdminHub', 'DriverApp', 'FirebaseFunction', 'Init.Map' etc.
            context: { // Ensure context is serializable
                ...JSON.parse(JSON.stringify(context || {})), // Basic sanitization
                sessionId,
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
                page: typeof window !== 'undefined' ? window.location.pathname : 'N/A'
            },
            user: userContext,
            // v49.0: Add watchdog fields
            category: category || null, // e.g., 'MapEngine', 'FirebaseAuth'
            solution: solution || null // e.g., 'Check Leaflet initialization order'
        };

        // הוספת המסמך ל-Firestore
        await addDoc(collection(db, LOG_COLLECTION), logEntry);

    } catch (error) {
        // אם הלוגר נכשל, הוא כותב לקונסול (כבר נכתב למעלה)
        // Log the failure to write the log itself
        console.error("SmartLog FATAL ERROR: Failed to write log entry to Firestore.", error, { originalMessage: message });
        // Optionally, implement a fallback mechanism (e.g., local storage queue)
    }
};

// ממשק חיצוני
const SmartLog = {
    /**
     * רושם הודעת מידע
     * @param {string} message - ההודעה לרישום
     * @param {string} origin - מקור ההודעה (למשל 'MapModule')
     * @param {object} [context={}] - אובייקט עם נתונים נוספים
     */
    info: (message, origin, context = {}) => {
        writeLog('INFO', message, origin, context);
    },

    /**
     * רושם הודעת אזהרה
     * @param {string} message - ההודעה לרישום
     * @param {string} origin - מקור ההודעה
     * @param {object} [context={}] - אובייקט עם נתונים נוספים
     * @param {string} [category=null] - v49.0: קטגוריית Watchdog
     * @param {string} [solution=null] - v49.0: פתרון מוצע
     */
    warn: (message, origin, context = {}, category = null, solution = null) => {
        writeLog('WARN', message, origin, context, category, solution);
    },

    /**
     * רושם הודעת שגיאה, כולל Stack Trace
     * @param {Error|string} error - אובייקט השגיאה או הודעת שגיאה
     * @param {string} origin - מקור השגיאה
     * @param {object} [context={}] - אובייקט עם נתונים נוספים
     * @param {string} [category=null] - v49.0: קטגוריית Watchdog
     * @param {string} [solution=null] - v49.0: פתרון מוצע
     */
    error: (error, origin, context = {}, category = null, solution = null) => {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : 'No stack trace available';
        writeLog('ERROR', message, origin, { ...context, stack }, category, solution);
    }
};

// ייצוא המודול
export { SmartLog };
