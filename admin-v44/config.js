// config.js (v45.0)
// v45.0: הוספת ייצוא של authReady Promise
// קובץ הגדרות מרכזי לכלל האפליקציה
// משתמש ב-SDK v9 (Modular)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-functions.js";

// תצורת ה-Firebase שלך (מבוסס על קבצים קודמים v34-v43)
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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'europe-west1'); // בחר את האזור שלך

// v45.0: התחברות אנונימית אוטומטית, מחזירה Promise
const authReady = new Promise((resolve, reject) => {
    signInAnonymously(auth)
        .then((userCredential) => {
            console.log("Firebase Connected Anonymously.", userCredential.user.uid);
            resolve(userCredential.user);
        })
        .catch((error) => {
            console.error("Firebase Anonymous Auth Failed", error);
            reject(error);
        });
});


// ייצוא הרכיבים וה-Promise
export { app, auth, db, functions, authReady };
