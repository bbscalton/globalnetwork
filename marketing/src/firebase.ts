import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'

function readEnv(name: string): string {
  return ((import.meta.env as Record<string, string | undefined>)[name] ?? '').trim()
}

const configured = Boolean(readEnv('VITE_FIREBASE_API_KEY') && readEnv('VITE_FIREBASE_PROJECT_ID'))

const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID'),
  measurementId: readEnv('VITE_FIREBASE_MEASUREMENT_ID') || undefined,
}

let app: FirebaseApp | null = null
let db: Firestore | null = null

if (configured) {
  try {
    app = initializeApp(firebaseConfig)
    db = getFirestore(app)
  } catch (err) {
    console.error('Marketing Firebase failed to initialize', err)
    app = null
    db = null
  }
}

export { db }
export const FIREBASE_CONFIGURED = Boolean(db)
