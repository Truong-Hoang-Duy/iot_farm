import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';
import { getAuth, signInWithEmailAndPassword, reauthenticateWithCredential, updatePassword, EmailAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAdz1kdrZbArYG8NfCksSvubcOk-es-JP4",
  authDomain: "iot-farm-chilli.firebaseapp.com",
  databaseURL: "https://iot-farm-chilli-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "iot-farm-chilli",
  storageBucket: "iot-farm-chilli.firebasestorage.app",
  messagingSenderId: "824631030823",
  appId: "1:824631030823:web:137bcd2a4e73f4da188a02"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export { auth, db, signInWithEmailAndPassword, reauthenticateWithCredential, updatePassword, EmailAuthProvider };
