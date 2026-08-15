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
import { doc, getDoc } from 'firebase/firestore'
import { auth, COL, db, FIREBASE_CONFIGURED } from './firebase'
import { isProjectAdmin } from './admin'

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

  const isAdmin = isProjectAdmin(user?.email)

  useEffect(() => {
    if (!FIREBASE_CONFIGURED || !auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, async (next) => {
      setUser(next)
      setBlockedMessage(null)
      if (next && db) {
        const staff = await getDoc(doc(db, COL.staffProfiles, next.uid)).catch(() => null)
        const staffOk = isProjectAdmin(next.email) || staff?.exists() === true
        setIsStaff(staffOk)
        setOrgId((staff?.data()?.orgId as string | undefined) ?? 'globalnetwork')
        if (staff?.data()?.blocked === true) {
          setBlockedMessage('This staff account is suspended.')
          if (auth) await firebaseSignOut(auth)
        }
      } else {
        setIsStaff(false)
        setOrgId(null)
      }
      setLoading(false)
    })
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
        await signInWithPopup(auth, new GoogleAuthProvider())
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
