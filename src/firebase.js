import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: "AIzaSyAW8zgpKXce4Ek58lp8rDZENIDoYrkEHL0",
  authDomain: "syllabo-60d77.firebaseapp.com",
  databaseURL: "https://syllabo-60d77-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "syllabo-60d77",
  storageBucket: "syllabo-60d77.firebasestorage.app",
  messagingSenderId: "240135480906",
  appId: "1:240135480906:web:204f20a55097d234d728b3",
  measurementId: "G-T61XNH3FY3"
}

const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)
