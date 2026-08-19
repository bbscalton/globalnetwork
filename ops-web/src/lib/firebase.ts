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

const FIREBASE_ENV = Boolean(readEnv('VITE_FIREBASE_API_KEY') && readEnv('VITE_FIREBASE_PROJECT_ID'))

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

function bootFirebase(): {
  app: FirebaseApp | null
  auth: Auth | null
  db: ReturnType<typeof getFirestore> | null
  functions: ReturnType<typeof getFunctions> | null
  configured: boolean
} {
  if (!FIREBASE_ENV) {
    return { app: null, auth: null, db: null, functions: null, configured: false }
  }
  try {
    const firebaseApp = initializeApp(firebaseConfig)
    return {
      app: firebaseApp,
      auth: createAuth(firebaseApp),
      db: getFirestore(firebaseApp),
      functions: getFunctions(firebaseApp, 'us-central1'),
      configured: true,
    }
  } catch (err) {
    console.error('Firebase failed to initialize', err)
    return { app: null, auth: null, db: null, functions: null, configured: false }
  }
}

const boot = bootFirebase()
export const app = boot.app
export const auth = boot.auth
export const db = boot.db
export const functions = boot.functions
export const FIREBASE_CONFIGURED = boot.configured

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
  deskMembers: 'deskMembers',
  deskInvites: 'deskInvites',
  posOutlets: 'posOutlets',
  calls: 'calls',
  iceOffer: 'iceOffer',
  iceAnswer: 'iceAnswer',
} as const

export const ONLINE_AFTER_MS = 15 * 60 * 1000
