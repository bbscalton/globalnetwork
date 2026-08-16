import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth, FIREBASE_CONFIGURED } from './firebase'
import { isProjectAdmin, ORG_ID } from './admin'
import { registerOwnerDevice } from './repo'

type AuthContextValue = {
  configured: boolean
  user: User | null
  loading: boolean
  isOwner: boolean
  orgId: string
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const isOwner = isProjectAdmin(user)

  useEffect(() => {
    if (!FIREBASE_CONFIGURED || !auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!isOwner) return
    void registerOwnerDevice().catch(() => undefined)
  }, [isOwner, user?.uid])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: FIREBASE_CONFIGURED,
      user,
      loading,
      isOwner,
      orgId: ORG_ID,
      signIn: async (email, password) => {
        if (!auth) throw new Error('Firebase is not configured for this build.')
        await signInWithEmailAndPassword(auth, email, password)
      },
      signInWithGoogle: async () => {
        if (!auth) throw new Error('Firebase is not configured for this build.')
        await signInWithPopup(auth, new GoogleAuthProvider())
      },
      signOut: async () => {
        if (auth) await firebaseSignOut(auth)
      },
    }),
    [user, loading, isOwner],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
