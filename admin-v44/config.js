// config.js (v47.5)
// תיקון שגיאת ייצוא (export) בבלוק catch

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
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
let initializationError = null; // v47.5: Store potential initialization error

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, 'europe-west1');
    console.log("Firebase app initialized successfully in config.js (v47.5)");
} catch (error) {
     console.error("CRITICAL ERROR: Firebase initialization failed in config.js!", error);
     initializationError = error; // v47.5: Save the error
     // Do not export from here!
}

// --- v47.5: Authentication Promise - Handles initialization errors ---
const authReady = new Promise((resolve, reject) => {
    // v47.5: Check if initialization failed earlier
    if (initializationError) {
        console.error("authReady: Failing early due to initialization error.");
        reject(new Error(`Firebase initialization failed: ${initializationError.message}`));
        return;
    }
    // Ensure auth object exists before proceeding
    if (!auth) {
         console.error("authReady: Firebase auth object is not available.");
         reject(new Error("Firebase auth object failed to initialize."));
         return;
    }

    console.log("authReady (v47.5): Attempting anonymous sign-in (30s timeout)...");
    const authTimeout = setTimeout(() => {
        console.error("authReady: Anonymous sign-in timed out after 30 seconds.");
        reject(new Error("Firebase anonymous sign-in timed out (30s). Check network/config."));
    }, 30000); // 30 second timeout

    signInAnonymously(auth)
        .then((userCredential) => {
            clearTimeout(authTimeout);
            console.log("authReady: Anonymous sign-in successful.", userCredential.user.uid);
            resolve(userCredential.user); // Resolve with the user object
        })
        .catch((error) => {
            clearTimeout(authTimeout);
            console.error("authReady: Anonymous sign-in failed!", error.code, error.message);
            reject(error); // Reject the promise on failure
        });
});

// v47.5: Single export statement at the top level
export { app, auth, db, functions, authReady };

