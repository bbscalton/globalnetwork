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
import { claimStaffAccess } from './repo'
import { accessFromRole, parseRole, type StaffRole } from './roles'

type AuthContextValue = {
  configured: boolean
  user: User | null
  loading: boolean
  role: StaffRole | null
  pendingAccess: boolean
  isAdmin: boolean
  isStaff: boolean
  canTcd: boolean
  canDesk: boolean
  canSupport: boolean
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
  const [role, setRole] = useState<StaffRole | null>(null)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)

  const owner = isProjectAdmin(user)
  const access = accessFromRole(role, owner)

  const firebaseAuth = auth
  useEffect(() => {
    if (!FIREBASE_CONFIGURED || !firebaseAuth) {
      setLoading(false)
      return
    }
    let cancelled = false
    let unsub = () => {}
    void (async () => {
      await completeGoogleRedirect(firebaseAuth)
      if (cancelled) return
      unsub = onAuthStateChanged(firebaseAuth, async (next) => {
        setBlockedMessage(null)
        if (!next) {
          setUser(null)
          setRole(null)
          setOrgId(null)
          setLoading(false)
          return
        }
        setLoading(true)
        setUser(next)
        try {
          const claimed = await claimStaffAccess()
          if (cancelled) return
          setRole(parseRole(claimed.role))
          setOrgId(claimed.orgId || 'globalnetwork')
        } catch {
          if (db) {
            const staff = await getDoc(doc(db, COL.staffProfiles, next.uid)).catch(() => null)
            if (cancelled) return
            const data = staff?.data()
            if (data?.blocked === true) {
              setBlockedMessage('This staff account is suspended.')
              await firebaseSignOut(firebaseAuth)
              return
            }
            setRole(staff?.exists() ? parseRole(data?.role) : 'pending')
            setOrgId((data?.orgId as string | undefined) ?? 'globalnetwork')
          } else {
            setRole(isProjectAdmin(next) ? 'admin' : 'pending')
          }
        }
        setLoading(false)
      })
    })()
    return () => {
      cancelled = true
      unsub()
    }
  }, [firebaseAuth])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: FIREBASE_CONFIGURED,
      user,
      loading,
      role,
      pendingAccess: access.pending,
      isAdmin: access.isAdmin,
      isStaff: access.canSupport,
      canTcd: access.canTcd,
      canDesk: access.canDesk,
      canSupport: access.canSupport,
      blockedMessage,
      orgId,
      signIn: async (email, password) => {
        if (!firebaseAuth) throw new Error('Firebase is not configured for this build.')
        await signInWithEmailAndPassword(firebaseAuth, email, password)
      },
      signInWithGoogle: async () => {
        if (!firebaseAuth) throw new Error('Firebase is not configured for this build.')
        await startGoogleSignIn(firebaseAuth)
      },
      signOut: async () => {
        if (firebaseAuth) await firebaseSignOut(firebaseAuth)
      },
    }),
    [user, loading, role, access, blockedMessage, orgId, firebaseAuth],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
