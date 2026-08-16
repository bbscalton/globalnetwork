import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
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
  try {
    return initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  } catch {
    return getAuth(firebaseApp)
  }
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
  staffProfiles: 'staffProfiles',
  orgs: 'orgs',
  adminConfig: 'adminConfig',
  adminAuditLogs: 'adminAuditLogs',
} as const

function defaultFunctionsHealthUrl(): string {
  const projectId = readEnv('VITE_FIREBASE_PROJECT_ID') || 'globalnetwork-isp'
  return `https://us-central1-${projectId}.cloudfunctions.net/platformHealth`
}

export const R2_BASE_URL = readEnv('VITE_R2_MEDIA_PROXY_BASE_URL') || 'https://globalnetwork-media.neuereatec.workers.dev'
export const PLATFORM_HEALTH_URL =
  readEnv('VITE_PLATFORM_HEALTH_URL') || `${R2_BASE_URL.replace(/\/$/, '')}/platform-health`
export const FUNCTIONS_HEALTH_URL = readEnv('VITE_FUNCTIONS_HEALTH_URL') || defaultFunctionsHealthUrl()
export const FIREBASE_CONSOLE_URL =
  readEnv('VITE_FIREBASE_CONSOLE_URL') ||
  `https://console.firebase.google.com/project/${readEnv('VITE_FIREBASE_PROJECT_ID') || 'globalnetwork-isp'}`
export const FIREBASE_AUTH_CONSOLE_URL = `${FIREBASE_CONSOLE_URL}/authentication/users`
export const FIREBASE_FIRESTORE_CONSOLE_URL = `${FIREBASE_CONSOLE_URL}/firestore`
export const FIREBASE_FUNCTIONS_CONSOLE_URL = `${FIREBASE_CONSOLE_URL}/functions`
export const MARKETING_URL = readEnv('VITE_MARKETING_URL') || 'https://bbscalton.github.io/globalnetwork/'
export const OPS_WEB_URL = readEnv('VITE_OPS_WEB_URL') || `${MARKETING_URL.replace(/\/?$/, '/')}ops/`
export const TCD_URL = readEnv('VITE_TCD_URL') || `${MARKETING_URL.replace(/\/?$/, '/')}tcd.html`
export const GITHUB_REPO_URL = readEnv('VITE_GITHUB_REPO_URL') || 'https://github.com/bbscalton/globalnetwork'
export const ONLINE_AFTER_MS = 15 * 60 * 1000
