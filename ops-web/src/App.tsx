import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/authContext'
import { consumeGoogleAuthError, googleAuthErrorMessage } from './lib/googleAuth'
import * as repo from './lib/repo'
import { ONLINE_AFTER_MS } from './lib/firebase'
import { deskPulse } from './lib/desk'
import type { Customer, IssueTicket, Plan } from './lib/types'
import { roleLabel } from './lib/roles'
import { Board } from './Board'
import { CustomerPage } from './CustomerPage'
import { ChatDesk } from './ChatDesk'
import { IssuesDesk } from './IssuesDesk'

export default function App() {
  const { configured, user, loading, canDesk, canSupport, pendingAccess, signIn, signInWithGoogle, signOut, orgId, role } =
    useAuth()
  if (!configured) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Customer desk not configured</h1>
          <p className="muted">This GitHub Pages build is missing Firebase keys.</p>
        </div>
      </div>
    )
  }
  if (loading) return <div className="auth">Opening customer desk…</div>
  if (!user) return <Login signIn={signIn} signInWithGoogle={signInWithGoogle} />
  if (pendingAccess) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Waiting for a role</h1>
          <p className="muted">
            Signed in as {user.email}. You are on the TCD user list. A control admin must assign Customer desk or
            Support before you can manage subscribers.
          </p>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }
  if (!canSupport) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>No desk access yet</h1>
          <p className="muted">Signed in as {user.email}. Ask a control admin to assign your Google account a role in TCD → Users.</p>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return (
    <Shell
      orgId={orgId || 'globalnetwork'}
      email={user.email || ''}
      canDesk={canDesk}
      roleLabel={roleLabel(role)}
      signOut={signOut}
    />
  )
}

function Login({
  signIn,
  signInWithGoogle,
}: {
  signIn: (e: string, p: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(() => consumeGoogleAuthError())
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(googleAuthErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const onGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(googleAuthErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" width={56} height={56} className="auth-logo" />
        <p className="eyebrow">GlobalNetwork</p>
        <h1>Customer desk</h1>
        <p className="muted">Google sign-in puts you on the user list. A control admin assigns your role from TCD.</p>
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="fail">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void onGoogle()}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p className="muted tiny">Allow popups for Google sign-in.</p>
      </form>
    </div>
  )
}

function Shell({
  orgId,
  email,
  canDesk,
  roleLabel: roleName,
  signOut,
}: {
  orgId: string
  email: string
  canDesk: boolean
  roleLabel: string
  signOut: () => Promise<void>
}) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [issues, setIssues] = useState<IssueTicket[]>([])
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const u1 = repo.observeCustomers(orgId, setCustomers, (e) => setError(e.message))
    const u2 = repo.observePlans(setPlans)
    const u3 = repo.observeIssues(setIssues)
    return () => {
      u1()
      u2()
      u3()
    }
  }, [orgId])

  const pulse = useMemo(() => deskPulse(customers, issues, now, ONLINE_AFTER_MS), [customers, issues, now])

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" />
          <div>
            <strong>GlobalNetwork</strong>
            <div className="muted tiny">{roleName}</div>
          </div>
        </div>
        {canDesk && (
          <NavLink to="/" end>
            Roster
            <span className="nav-count">{pulse.total}</span>
          </NavLink>
        )}
        <NavLink to="/chat">
          Inbox
          {pulse.unread.length > 0 && <span className="nav-count hot">{pulse.unread.length}</span>}
        </NavLink>
        <NavLink to="/issues">
          Issues
          {pulse.openIssues > 0 && <span className="nav-count hot">{pulse.openIssues}</span>}
        </NavLink>
        <div className="side-pulse">
          <p>
            <b>{pulse.active}</b> live
          </p>
          <p>
            <b>{pulse.grace}</b> grace · <b>{pulse.expired}</b> expired
          </p>
          <p className="tiny">{email}</p>
        </div>
        <button className="link" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </aside>
      <main className="main">
        {error && <p className="fail">{error}</p>}
        <Routes>
          <Route
            path="/"
            element={
              canDesk ? (
                <Board customers={customers} plans={plans} issues={issues} now={now} />
              ) : (
                <Navigate to="/chat" replace />
              )
            }
          />
          <Route
            path="/c/:id"
            element={
              canDesk ? (
                <CustomerPage customers={customers} plans={plans} issues={issues} now={now} />
              ) : (
                <Navigate to="/chat" replace />
              )
            }
          />
          <Route path="/chat" element={<ChatDesk customers={customers} />} />
          <Route path="/issues" element={<IssuesDesk issues={issues} />} />
          <Route path="*" element={<Navigate to={canDesk ? '/' : '/chat'} replace />} />
        </Routes>
      </main>
    </div>
  )
}
