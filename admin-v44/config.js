// config.js (v49.0)
// הטמעת מנגנון ניסיון חוזר (retry) לאימות

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js"; // v49.0: Import getApps, getApp
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-functions.js";

// תצורת ה-Firebase שלך
const firebaseConfig = {
  apiKey: "AIzaSyDq0oVwS6zbEfsgrYBRkeBq80dDUKMedzo",
  authDomain: "saban94-78949.firebaseapp.com",
  projectId: "saban94-78949",
  storageBucket: "saban94-78949.firebasestorage.app",
  messagingSenderId: "41553157903",
  appId: "1:41553157903:web:cc33d252cff023be97a87a",
  measurementId: "G-XV6RZDESSB"
};

// אתחול רכיבים
let app, auth, db, functions;
let initializationError = null;

try {
    // v49.0: Initialize Firebase app safely (ensure only once)
    if (!getApps().length) {
        app = initializeApp(firebaseConfig);
        console.log("Firebase app initialized successfully in config.js (v49.0)");
    } else {
        app = getApp(); // Get existing app
        console.log("Firebase app already initialized, getting existing instance (v49.0).");
    }

    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, 'europe-west1');

} catch (error) {
     console.error("CRITICAL ERROR: Firebase initialization failed in config.js!", error);
     initializationError = error;
}

// --- v49.0: Authentication Promise with Retry Mechanism ---
const MAX_AUTH_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

async function ensureAuth() {
    console.log("ensureAuth (v49.0): Starting authentication process...");
    let tries = 0;
    while (tries < MAX_AUTH_RETRIES) {
        tries++;
        try {
            if (initializationError) {
                console.error("ensureAuth: Failing early due to initialization error.");
                throw new Error(`Firebase initialization failed: ${initializationError.message}`);
            }
            if (!auth) {
                 console.error("ensureAuth: Firebase auth object is not available.");
                 throw new Error("Firebase auth object failed to initialize.");
            }

            console.log(`ensureAuth: Attempt ${tries}/${MAX_AUTH_RETRIES} - Calling signInAnonymously...`);
            const userCredential = await signInAnonymously(auth);
            console.log("ensureAuth: Anonymous sign-in successful.", userCredential.user.uid);
            return userCredential.user; // Resolve with the user object on success

        } catch (e) {
            console.warn(`[FirebaseAuth] Attempt ${tries} failed:`, e.code, e.message);
            if (tries >= MAX_AUTH_RETRIES) {
                console.error("ensureAuth: All sign-in attempts failed.");
                throw e; // Re-throw the last error after max retries
            }
            console.log(`ensureAuth: Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS)); // Wait before retrying
        }
    }
    // Should not reach here if successful, but as a fallback:
    throw new Error("ensureAuth: Maximum retries reached without successful authentication.");
}

// authReady is now the result of calling ensureAuth
const authReady = ensureAuth();

// Single export statement at the top level
export { app, auth, db, functions, authReady };

