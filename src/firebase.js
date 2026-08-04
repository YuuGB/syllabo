import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

// ⚠️ Remplace par la config de TON projet Firebase
// (Console Firebase > Paramètres du projet > Tes applications > SDK config)
const firebaseConfig = {
  apiKey: "TA_API_KEY",
  authDomain: "TON_PROJET.firebaseapp.com",
  databaseURL: "https://TON_PROJET-default-rtdb.firebaseio.com",
  projectId: "TON_PROJET",
  storageBucket: "TON_PROJET.appspot.com",
  messagingSenderId: "TON_SENDER_ID",
  appId: "TON_APP_ID"
}

const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)
