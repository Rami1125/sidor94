// config.js (v47.4)
// הגדלת timeout להתחברות

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
let authReadyReject; // v47.4 Store reject function for external access if needed

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, 'europe-west1');
    console.log("Firebase app initialized successfully in config.js");
} catch (error) {
     console.error("CRITICAL ERROR: Firebase initialization failed in config.js!", error);
     authReadyReject = () => Promise.reject(error); // Function to return rejected promise
     // Continue exporting essentials, but authReady will be rejected
     const authReady = authReadyReject();
     export { app, auth, db, functions, authReady };
     // No need to throw here, let the authReady rejection handle it
}

// --- v47.4: Authentication Promise with increased timeout and clearer logging ---
const authReady = new Promise((resolve, reject) => {
    // Save reject function in case initialization failed earlier
    if (authReadyReject) {
        reject(new Error("Firebase initialization failed before sign-in attempt."));
        return;
    }
    console.log("authReady (v47.4): Attempting anonymous sign-in (30s timeout)...");
    const authTimeout = setTimeout(() => {
        console.error("authReady: Anonymous sign-in timed out after 30 seconds.");
        reject(new Error("Firebase anonymous sign-in timed out (30s). Check network/config."));
    }, 30000); // 30 second timeout

    signInAnonymously(auth)
        .then((userCredential) => {
            clearTimeout(authTimeout);
            console.log("authReady: Anonymous sign-in successful.", userCredential.user.uid);
            resolve(userCredential.user);
        })
        .catch((error) => {
            clearTimeout(authTimeout);
            console.error("authReady: Anonymous sign-in failed!", error.code, error.message); // Log code and message
            reject(error); // Reject the promise on failure
        });
});

// ייצוא הרכיבים וה-Promise
export { app, auth, db, functions, authReady };

