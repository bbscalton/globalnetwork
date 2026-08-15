import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'

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
      return 'Google sign-in is not enabled yet on this Firebase project. Open Authentication in the Firebase console, click Get started, enable Google, and add bbscalton.github.io as an authorized domain.'
    case 'auth/operation-not-allowed':
      return 'Google is not enabled as a sign-in provider. Enable Google under Authentication → Sign-in method.'
    case 'auth/unauthorized-domain':
      return 'This site is not an authorized domain. Add bbscalton.github.io in Authentication → Settings → Authorized domains.'
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked. Allow popups for this site, or wait for redirect sign-in.'
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

function preferRedirect(): boolean {
  if (typeof window === 'undefined') return false
  return /github\.io$/i.test(window.location.hostname)
}

export async function completeGoogleRedirect(auth: Auth): Promise<void> {
  await getRedirectResult(auth)
}

export async function signInWithGoogle(auth: Auth): Promise<void> {
  const provider = googleProvider()
  if (preferRedirect()) {
    await signInWithRedirect(auth, provider)
    return
  }
  try {
    await signInWithPopup(auth, provider)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : ''
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, provider)
      return
    }
    throw err
  }
}
