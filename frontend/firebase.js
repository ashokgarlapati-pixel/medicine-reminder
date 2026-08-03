// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// TODO: Replace with your app's Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyBULn-Z0CKTSA1XK7es3flCqt4XTjaiqBk",
  authDomain: "medicine-reminder-app-d041b.firebaseapp.com",
  projectId: "medicine-reminder-app-d041b",
  storageBucket: "medicine-reminder-app-d041b.firebasestorage.app",
  messagingSenderId: "776195409712",
  appId: "1:776195409712:web:8299067d437f69b8126af5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut };
