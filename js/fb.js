// Firebase SDK (loaded from Google's CDN). Change the version in one place here.
export { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
export {
  getAuth, initializeAuth, inMemoryPersistence, connectAuthEmulator, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
export {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, writeBatch, runTransaction,
  serverTimestamp, Timestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
