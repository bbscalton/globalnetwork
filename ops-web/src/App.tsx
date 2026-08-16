import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/authContext'
import { consumeGoogleAuthError, googleAuthErrorMessage } from './lib/googleAuth'
import * as repo from './lib/repo'
import { ONLINE_AFTER_MS } from './lib/firebase'
import { deskPulse } from './lib/desk'
import type { Customer, IssueTicket, Plan } from './lib/types'
import { Board } from './Board'
import { CustomerPage } from './CustomerPage'
import { ChatDesk } from './ChatDesk'
import { IssuesDesk } from './IssuesDesk'
import { PlansDesk } from './PlansDesk'

export default function App() {
  const { configured, user, loading, isOwner, signIn, signInWithGoogle, signOut, orgId } = useAuth()
  if (!configured) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Owner desk not configured</h1>
          <p className="muted">This GitHub Pages build is missing Firebase keys.</p>
        </div>
      </div>
    )
  }
  if (loading) return <div className="auth">Opening owner desk…</div>
  if (!user) return <Login signIn={signIn} signInWithGoogle={signInWithGoogle} />
  if (!isOwner) {
    return (
      <div className="auth">
        <div className="auth-card">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" width={56} height={56} className="auth-logo" />
          <h1>Owner only</h1>
          <p className="muted">
            Signed in as {user.email}. The GlobalNetwork desk is for the owner account. Customers use the
            iOS and Android app.
          </p>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return <Shell orgId={orgId} email={user.email || ''} signOut={signOut} />
}

function Login({
  signIn,
  signInWithGoogle,
}: {
  signIn: (e: string, p: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
}) {
  const [email, setEmail] = useState('neuereatec@gmail.com')
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
      <form className="auth-card gn-glow" onSubmit={(e) => void submit(e)}>
        <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="GlobalNetwork" width={72} height={72} className="auth-logo gn-spin" />
        <p className="eyebrow">GlobalNetwork</p>
        <h1>Owner desk</h1>
        <p className="muted">Sign in to manage customer internet subscriptions, grant days, and chat.</p>
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="fail">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void onGoogle()}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p className="muted tiny">Owner: neuereatec@gmail.com · Allow popups for Google.</p>
      </form>
    </div>
  )
}

function Shell({
  orgId,
  email,
  signOut,
}: {
  orgId: string
  email: string
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
            <div className="muted tiny">Owner desk</div>
          </div>
        </div>
        <NavLink to="/" end>
          Roster
          <span className="nav-count">{pulse.total}</span>
        </NavLink>
        <NavLink to="/chat">
          Inbox
          {pulse.unread.length > 0 && <span className="nav-count hot gn-pulse">{pulse.unread.length}</span>}
        </NavLink>
        <NavLink to="/issues">
          Issues
          {pulse.openIssues > 0 && <span className="nav-count hot">{pulse.openIssues}</span>}
        </NavLink>
        <NavLink to="/plans">Plans</NavLink>
        <div className="side-pulse">
          <p>
            <b className="live-num">{pulse.active}</b> live
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
          <Route path="/" element={<Board customers={customers} plans={plans} issues={issues} now={now} />} />
          <Route path="/c/:id" element={<CustomerPage customers={customers} plans={plans} issues={issues} now={now} />} />
          <Route path="/chat" element={<ChatDesk customers={customers} />} />
          <Route path="/issues" element={<IssuesDesk issues={issues} />} />
          <Route path="/plans" element={<PlansDesk plans={plans} customers={customers} now={now} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
