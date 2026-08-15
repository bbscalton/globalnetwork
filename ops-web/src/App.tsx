import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from './lib/authContext'
import * as repo from './lib/repo'
import type { ChatMessage, Customer, IssueTicket, Plan } from './lib/types'

export default function App() {
  const { configured, user, loading, isStaff, isAdmin, signIn, signInWithGoogle, signOut, orgId } = useAuth()
  if (!configured) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Ops not configured</h1>
          <p className="muted">Set VITE_FIREBASE_* on the Firebase Hosting build.</p>
        </div>
      </div>
    )
  }
  if (loading) return <div className="auth">Loading…</div>
  if (!user) return <Login signIn={signIn} signInWithGoogle={signInWithGoogle} />
  if (!isStaff && !isAdmin) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Staff only</h1>
          <p className="muted">Ask neuereatec@gmail.com to add a staffProfiles/{'{uid}'} document.</p>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return <Shell orgId={orgId || 'globalnetwork'} email={user.email || ''} signOut={signOut} />
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
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <img src="/logo-gn.png" alt="" width={48} height={48} style={{ borderRadius: '50%' }} />
        <h1>GlobalNetwork</h1>
        <p className="muted">Staff dashboard — manage subscriptions, extend days, chat.</p>
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="fail">{error}</p>}
        <button className="btn btn-primary" type="submit">
          Sign in
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void signInWithGoogle()}>
          Continue with Google
        </button>
      </form>
    </div>
  )
}

function Shell({ orgId, email, signOut }: { orgId: string; email: string; signOut: () => Promise<void> }) {
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

  const pulse = useMemo(
    () => ({
      active: customers.filter((c) => c.status === 'active').length,
      grace: customers.filter((c) => c.status === 'grace').length,
      expired: customers.filter((c) => c.status === 'expired').length,
    }),
    [customers],
  )

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/logo-gn.png" alt="" />
          GlobalNetwork
        </div>
        <NavLink to="/" end>
          Customers
        </NavLink>
        <NavLink to="/chat">Chat</NavLink>
        <NavLink to="/issues">Issues</NavLink>
        <NavLink to="/plans">Plans</NavLink>
        <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.8rem' }}>
          {email}
        </p>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          {pulse.active} live · {pulse.grace} grace · {pulse.expired} expired
        </p>
        <button className="link" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </aside>
      <main className="main">
        {error && <p className="fail">{error}</p>}
        <Routes>
          <Route path="/" element={<CustomersPage customers={customers} plans={plans} now={now} />} />
          <Route path="/chat" element={<ChatPage customers={customers} />} />
          <Route path="/issues" element={<IssuesPage issues={issues} />} />
          <Route path="/plans" element={<PlansPage plans={plans} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function CustomersPage({ customers, plans, now }: { customers: Customer[]; plans: Plan[]; now: number }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', planId: '' })
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <>
      <h1>Customers</h1>
      <p className="muted" style={{ margin: '0.4rem 0 1.2rem' }}>
        Extend service by N days when they don’t have the full fee.
      </p>
      <form
        className="card"
        style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault()
          void repo
            .createCustomer(form)
            .then((r) => setMsg(`Created ${form.name} (${r.customerId})`))
            .catch((err) => setMsg(err instanceof Error ? err.message : 'failed'))
        }}
      >
        <strong>New customer</strong>
        <div className="row">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
            <option value="">Plan…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </form>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Days left</th>
              <th>Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted">{c.phone}</div>
                </td>
                <td>
                  <span className={`pill ${c.status === 'active' ? 'ok' : c.status === 'grace' ? 'warn' : 'fail'}`}>{c.status}</span>
                </td>
                <td>{repo.daysLeft(c.paidUntilMs, now)}</td>
                <td>{repo.formatGyd(c.balanceDue)}</td>
                <td>
                  <button className="btn btn-ghost" type="button" onClick={() => navigate(`/chat?c=${c.id}`)}>
                    Chat
                  </button>
                  <ExtendInline customer={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ExtendInline({ customer }: { customer: Customer }) {
  const [days, setDays] = useState('7')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  return (
    <form
      className="row"
      style={{ marginTop: '0.4rem' }}
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        void repo
          .extendSubscription({
            customerId: customer.id,
            days: Number(days),
            amountPaid: Number(amount || 0),
            note,
          })
          .finally(() => setBusy(false))
      }}
    >
      <input style={{ maxWidth: 70 }} value={days} onChange={(e) => setDays(e.target.value)} title="Days" />
      <input style={{ maxWidth: 90 }} placeholder="GYD paid" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input style={{ maxWidth: 140 }} placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Extend
      </button>
    </form>
  )
}

function ChatPage({ customers }: { customers: Customer[] }) {
  const [selected, setSelected] = useState(customers[0]?.id ?? '')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const c = params.get('c')
    if (c) setSelected(c)
  }, [])
  useEffect(() => {
    if (!selected) return
    return repo.observeChat(selected, setMessages)
  }, [selected])
  return (
    <>
      <h1>Chat</h1>
      <div className="grid" style={{ marginTop: '1rem' }}>
        <div className="card">
          {customers.map((c) => (
            <button key={c.id} className="btn btn-ghost" type="button" style={{ width: '100%', marginBottom: 6 }} onClick={() => setSelected(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          {messages.map((m) => (
            <p key={m.id}>
              <strong>{m.from}:</strong> {m.text}
            </p>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (!selected || !draft.trim()) return
              void repo.sendChat(selected, draft.trim(), 'staff')
              setDraft('')
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply…" />
            <button className="btn btn-primary" type="submit">
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

function IssuesPage({ issues }: { issues: IssueTicket[] }) {
  return (
    <>
      <h1>Issues</h1>
      <div className="grid" style={{ marginTop: '1rem' }}>
        {issues.map((i) => (
          <article key={`${i.customerId}-${i.id}`} className="card">
            <span className={`pill ${i.status === 'resolved' ? 'ok' : 'warn'}`}>{i.status}</span>
            <h3 style={{ marginTop: 8 }}>{i.title}</h3>
            <p className="muted">
              {i.customerName} · {new Date(i.createdAtMs).toLocaleString()}
            </p>
            <p>{i.body}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {i.photoUrls.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt="" width={72} height={72} style={{ objectFit: 'cover', borderRadius: 8 }} />
                </a>
              ))}
            </div>
          </article>
        ))}
        {issues.length === 0 && <p className="muted">No tickets.</p>}
      </div>
    </>
  )
}

function PlansPage({ plans }: { plans: Plan[] }) {
  return (
    <>
      <h1>Plans</h1>
      <div className="grid" style={{ marginTop: '1rem' }}>
        {plans.map((p) => (
          <article key={p.id} className="card">
            <h3>{p.name}</h3>
            <p className="kpi">{repo.formatGyd(p.feeAmount)}</p>
            <p className="muted">{p.days} days</p>
          </article>
        ))}
      </div>
    </>
  )
}
