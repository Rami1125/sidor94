// config.js (v47.7)
// הסרת timeout ידני מהתחברות

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
let initializationError = null;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, 'europe-west1');
    console.log("Firebase app initialized successfully in config.js (v47.7)");
} catch (error) {
     console.error("CRITICAL ERROR: Firebase initialization failed in config.js!", error);
     initializationError = error;
}

// --- Authentication Promise - Handles initialization errors ---
const authReady = new Promise((resolve, reject) => {
    if (initializationError) {
        console.error("authReady: Failing early due to initialization error.");
        reject(new Error(`Firebase initialization failed: ${initializationError.message}`));
        return;
    }
    if (!auth) {
         console.error("authReady: Firebase auth object is not available.");
         reject(new Error("Firebase auth object failed to initialize."));
         return;
    }

    console.log("authReady (v47.7): Attempting anonymous sign-in..."); // Removed timeout mention

    // v47.7: Rely directly on signInAnonymously promise, remove manual setTimeout
    signInAnonymously(auth)
        .then((userCredential) => {
            console.log("authReady: Anonymous sign-in successful.", userCredential.user.uid);
            resolve(userCredential.user); // Resolve with the user object
        })
        .catch((error) => {
            console.error("authReady: Anonymous sign-in failed!", error.code, error.message);
            // Optionally customize error based on code for better user feedback
            if (error.code === 'auth/network-request-failed') {
                 reject(new Error("Firebase sign-in failed: Network error. Please check your internet connection."));
            } else {
                 reject(error); // Reject with the original Firebase error
            }
        });
});

// Single export statement at the top level
export { app, auth, db, functions, authReady };

