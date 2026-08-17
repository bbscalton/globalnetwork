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
import { AccountsDesk } from './AccountsDesk'
import { DevicesDesk } from './DevicesDesk'
import { SUPPORTED_DEVICE_COUNT } from './lib/supportedDevices'

export default function App() {
  const { configured, user, loading, linking, isOwner, deskRole, member, linkError, signIn, signInWithGoogle, signOut, orgId } = useAuth()
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
  if (linking && !isOwner) {
    return <div className="auth">Checking your desk role…</div>
  }
  if (isOwner) {
    return <Shell orgId={orgId} email={user.email || ''} signOut={signOut} />
  }
  if (deskRole === 'pending') {
    return (
      <AccessGate
        title="Waiting for owner approval"
        body={`${user.email} signed in with Google. This is not the customer app. An approved owner must grant you a desk role before you can manage subscriptions.`}
        extra={member?.name ? `Signed in as ${member.name}.` : null}
        onSignOut={signOut}
      />
    )
  }
  if (deskRole === 'rejected') {
    return (
      <AccessGate
        title="Desk access was not approved"
        body={member?.rejectedReason || linkError || 'An owner turned down this Google account for the GlobalNetwork desk. Customers use the iOS and Android app.'}
        onSignOut={signOut}
      />
    )
  }
  return (
    <AccessGate
      title="Owner approval required"
      body={linkError || `Signed in as ${user.email}. Google sign-in on the owner desk needs approval. Ask an existing owner to assign your role.`}
      onSignOut={signOut}
    />
  )
}

function AccessGate({
  title,
  body,
  extra,
  onSignOut,
}: {
  title: string
  body: string
  extra?: string | null
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="auth">
      <div className="auth-card">
        <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" width={56} height={56} className="auth-logo" />
        <p className="eyebrow">GlobalNetwork desk</p>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        {extra && <p className="muted tiny">{extra}</p>}
        <button className="btn btn-ghost" type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
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
        <p className="muted">Antigua owner desk. Google sign-in still needs an approved owner role.</p>
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="fail">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void onGoogle()}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p className="muted tiny">Founding owner: neuereatec@gmail.com · Other Google accounts wait for approval.</p>
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
        <NavLink to="/devices">
          Devices
          <span className="nav-count">{SUPPORTED_DEVICE_COUNT}</span>
        </NavLink>
        <NavLink to="/accounts">Account & roles</NavLink>
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
          <Route path="/devices" element={<DevicesDesk />} />
          <Route path="/accounts" element={<AccountsDesk />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
