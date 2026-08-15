import { GoogleAuthProvider, getRedirectResult, signInWithPopup, type Auth } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'

const ERROR_KEY = 'gn.googleAuthError'
const FIREBASE_GOOGLE_PROVIDER_URL =
  'https://console.firebase.google.com/project/globalnetwork-isp/authentication/providers'

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider()
  provider.addScope('email')
  provider.setCustomParameters({ prompt: 'select_account' })
  return provider
}

export function googleAuthErrorMessage(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : ''
  switch (code) {
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return `Google sign-in is not enabled on this Firebase project yet. Enable the Google provider at ${FIREBASE_GOOGLE_PROVIDER_URL}`
    case 'auth/unauthorized-domain':
      return 'This site is not an authorized domain. Add bbscalton.github.io in Authentication → Settings → Authorized domains.'
    case 'auth/popup-blocked':
      return 'The Google sign-in popup was blocked. Allow popups for this site and try again.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was closed before it finished. Try again.'
    case 'auth/cancelled-popup-request':
      return 'Another Google sign-in was already in progress. Try again.'
    case 'auth/account-exists-with-different-credential':
      return 'This email already has a password account — sign in with email and password instead.'
    default:
      return err instanceof Error ? err.message : 'Google sign-in failed'
  }
}

export function consumeGoogleAuthError(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const msg = sessionStorage.getItem(ERROR_KEY)
  if (msg) sessionStorage.removeItem(ERROR_KEY)
  return msg
}

export async function completeGoogleRedirect(auth: Auth): Promise<string | null> {
  try {
    await getRedirectResult(auth)
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ERROR_KEY)
    return null
  } catch (err) {
    const msg = googleAuthErrorMessage(err)
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(ERROR_KEY, msg)
    return msg
  }
}

export async function signInWithGoogle(auth: Auth): Promise<void> {
  // Never use signInWithRedirect on GitHub Pages: the return trip drops the
  // session and the user lands back on the login screen with no error.
  await signInWithPopup(auth, googleProvider())
}
