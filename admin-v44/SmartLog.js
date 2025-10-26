// SmartLog.js (v3 - v44.0)
// מודול לוגים חכם הכותב ל-Firestore

import { db, auth } from './config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

const LOG_COLLECTION = 'system_logs_v3';
const sessionId = (Date.now() + Math.random()).toString(36);
let userContext = null;

// פונקציה פנימית לכתיבת הלוג
const writeLog = async (level, message, origin, context = {}) => {
    try {
        const user = auth.currentUser;
        userContext = user ? { uid: user.uid, isAnonymous: user.isAnonymous } : { uid: 'unknown' };

        const logEntry = {
            timestamp: serverTimestamp(),
            level, // 'INFO', 'WARN', 'ERROR'
            message: String(message),
            origin, // 'AdminHub', 'DriverApp', 'FirebaseFunction'
            context: {
                ...context, // נתונים ספציפיים (למשל, orderId)
                sessionId,
                userAgent: navigator.userAgent,
                page: window.location.pathname
            },
            user: userContext
        };

        // הוספת המסמך ל-Firestore
        await addDoc(collection(db, LOG_COLLECTION), logEntry);

    } catch (error) {
        // אם הלוגר נכשל, הוא כותב לקונסול
        console.error("SmartLog FATAL ERROR:", error, { originalMessage: message });
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
        console.log(`[${origin}] INFO:`, message, context);
        writeLog('INFO', message, origin, context);
    },

    /**
     * רושם הודעת אזהרה
     * @param {string} message - ההודעה לרישום
     * @param {string} origin - מקור ההודעה
     * @param {object} [context={}] - אובייקט עם נתונים נוספים
     */
    warn: (message, origin, context = {}) => {
        console.warn(`[${origin}] WARN:`, message, context);
        writeLog('WARN', message, origin, context);
    },

    /**
     * רושם הודעת שגיאה, כולל Stack Trace
     * @param {Error} error - אובייקט השגיאה
     * @param {string} origin - מקור השגיאה
     * @param {object} [context={}] - אובייקט עם נתונים נוספים
     */
    error: (error, origin, context = {}) => {
        console.error(`[${origin}] ERROR:`, error, context);
        writeLog('ERROR', error.message, origin, {
            ...context,
            stack: error.stack || 'No stack trace available'
        });
    }
};

// ייצוא המודול
export { SmartLog };
