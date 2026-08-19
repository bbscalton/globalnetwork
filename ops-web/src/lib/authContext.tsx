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
import { linkDeskAccount, observeDeskMember, registerOwnerDevice } from './repo'
import type { DeskMember, DeskRole } from './types'

type AuthContextValue = {
  configured: boolean
  user: User | null
  loading: boolean
  linking: boolean
  isOwner: boolean
  canDesk: boolean
  canOutlets: boolean
  canPos: boolean
  deskRole: DeskRole | null
  member: DeskMember | null
  linkError: string | null
  orgId: string
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)
  const [member, setMember] = useState<DeskMember | null>(null)
  const [deskRole, setDeskRole] = useState<DeskRole | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    if (!FIREBASE_CONFIGURED || !auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setLoading(false)
      if (!next) {
        setMember(null)
        setDeskRole(null)
        setLinkError(null)
      }
    })
  }, [])

  useEffect(() => {
    if (!user) return
    let unsub: (() => void) | undefined
    let gone = false
    setLinking(true)
    setLinkError(null)
    void (async () => {
      try {
        const linked = await linkDeskAccount()
        if (gone) return
        setDeskRole(linked.role)
        unsub = observeDeskMember(user.uid, (row) => {
          setMember(row)
          if (row) setDeskRole(row.role)
          if (row?.role === 'owner') void user.getIdToken(true).catch(() => undefined)
        })
      } catch (e) {
        if (gone) return
        if (isProjectAdmin(user)) {
          setDeskRole('owner')
        } else {
          setLinkError(e instanceof Error ? e.message : 'Could not open desk access.')
          setDeskRole(null)
        }
      } finally {
        if (!gone) setLinking(false)
      }
    })()
    return () => {
      gone = true
      unsub?.()
    }
  }, [user?.uid])

  const isOwner = deskRole === 'owner' || isProjectAdmin(user)
  const canDesk = isOwner
  const canOutlets = isOwner || deskRole === 'manager'
  const canPos = isOwner || deskRole === 'manager' || deskRole === 'cashier'

  useEffect(() => {
    if (!isOwner) return
    void registerOwnerDevice().catch(() => undefined)
  }, [isOwner, user?.uid])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: FIREBASE_CONFIGURED,
      user,
      loading,
      linking,
      isOwner,
      canDesk,
      canOutlets,
      canPos,
      deskRole,
      member,
      linkError,
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
    [user, loading, linking, isOwner, canDesk, canOutlets, canPos, deskRole, member, linkError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
