import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, COL, db, FIREBASE_CONFIGURED } from './firebase'
import { isProjectAdmin } from './admin'
import { completeGoogleRedirect, signInWithGoogle as startGoogleSignIn } from './googleAuth'

type AuthContextValue = {
  configured: boolean
  user: User | null
  loading: boolean
  isAdmin: boolean
  isStaff: boolean
  blockedMessage: string | null
  orgId: string | null
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isStaff, setIsStaff] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)

  const isAdmin = isProjectAdmin(user)

  useEffect(() => {
    if (!FIREBASE_CONFIGURED || !auth) {
      setLoading(false)
      return
    }
    let cancelled = false
    let unsub = () => {}
    void (async () => {
      await completeGoogleRedirect(auth)
      if (cancelled) return
      unsub = onAuthStateChanged(auth, async (next) => {
        setBlockedMessage(null)
        if (!next) {
          setUser(null)
          setIsStaff(false)
          setOrgId(null)
          setLoading(false)
          return
        }
        setLoading(true)
        const admin = isProjectAdmin(next)
        if (admin) {
          setIsStaff(true)
          setOrgId('globalnetwork')
        }
        setUser(next)
        if (db) {
          const staff = await getDoc(doc(db, COL.staffProfiles, next.uid)).catch(() => null)
          if (cancelled) return
          const staffOk = admin || staff?.exists() === true
          setIsStaff(staffOk)
          setOrgId((staff?.data()?.orgId as string | undefined) ?? 'globalnetwork')
          if (staff?.data()?.blocked === true) {
            setBlockedMessage('This staff account is suspended.')
            await firebaseSignOut(auth)
            return
          }
        }
        setLoading(false)
      })
    })()
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: FIREBASE_CONFIGURED,
      user,
      loading,
      isAdmin,
      isStaff: isAdmin || isStaff,
      blockedMessage,
      orgId,
      signIn: async (email, password) => {
        if (!auth) throw new Error('Firebase is not configured for this build.')
        await signInWithEmailAndPassword(auth, email, password)
      },
      signInWithGoogle: async () => {
        if (!auth) throw new Error('Firebase is not configured for this build.')
        await startGoogleSignIn(auth)
      },
      signOut: async () => {
        if (auth) await firebaseSignOut(auth)
      },
    }),
    [user, loading, isAdmin, isStaff, blockedMessage, orgId],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
