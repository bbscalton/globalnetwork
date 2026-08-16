import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  initializeAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

function readEnv(name: string): string {
  return ((import.meta.env as Record<string, string | undefined>)[name] ?? '').trim()
}

export const FIREBASE_CONFIGURED = Boolean(readEnv('VITE_FIREBASE_API_KEY') && readEnv('VITE_FIREBASE_PROJECT_ID'))

const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID'),
  measurementId: readEnv('VITE_FIREBASE_MEASUREMENT_ID') || undefined,
}

function createAuth(firebaseApp: FirebaseApp): Auth {
  let instance: Auth
  try {
    instance = initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  } catch {
    instance = getAuth(firebaseApp)
  }
  void setPersistence(instance, browserLocalPersistence).catch(() => undefined)
  return instance
}

export const app = FIREBASE_CONFIGURED ? initializeApp(firebaseConfig) : null
export const auth = app ? createAuth(app) : null
export const db = app ? getFirestore(app) : null
export const functions = app ? getFunctions(app, 'us-central1') : null

if (functions && import.meta.env.DEV && readEnv('VITE_FUNCTIONS_EMULATOR') === '1') {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

export const COL = {
  customers: 'customers',
  payments: 'payments',
  chatMessages: 'chatMessages',
  issues: 'issues',
  plans: 'plans',
  orgs: 'orgs',
  adminConfig: 'adminConfig',
  adminAuditLogs: 'adminAuditLogs',
} as const

export const ONLINE_AFTER_MS = 15 * 60 * 1000
