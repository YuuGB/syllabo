// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
apiKey: "AIzaSyAW8zgpKXce4Ek58lp8rDZENIDoYrkEHL0",
authDomain: "syllabo-60d77.firebaseapp.com",
databaseURL: "https://syllabo-60d77-default-rtdb.europe-west1.firebasedatabase.app",
projectId: "syllabo-60d77",
storageBucket: "syllabo-60d77.firebasestorage.app",
messagingSenderId: "240135480906",
appId: "1:240135480906:web:204f20a55097d234d728b3",
measurementId: "G-T61XNH3FY3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
