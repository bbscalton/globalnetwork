import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '@desk/lib/authContext'
import { consumeGoogleAuthError, googleAuthErrorMessage } from '@desk/lib/googleAuth'
import * as repo from '@desk/lib/repo'
import { daysLeft, formatEc } from '@desk/lib/repo'
import { fmtDate } from '@desk/lib/desk'
import type { Customer, PosOutlet } from '@desk/lib/types'
import { DAY_EXTENSION_RATE_XCD } from '@desk/lib/types'

const LOC_KEY = 'gn.pos.location'
const QUICK = [50, 100, 150, 200, 300, 400, 500]

type Site = { id: string; name: string }
type Screen = 'location' | 'search' | 'pay' | 'receipt'
type Receipt = {
  customerName: string
  amount: number
  days: number
  paidUntilMs: number
  balanceDue: number
  locationName: string
  atMs: number
  kind: 'collect' | 'extend'
  balanceAdded?: number
}

function readSite(): Site | null {
  try {
    const raw = localStorage.getItem(LOC_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Site
    if (parsed?.id && parsed?.name) return parsed
  } catch {
    /* ignore */
  }
  return null
}

export default function App() {
  const { configured, user, loading, linking, canPos, deskRole, member, linkError, signIn, signInWithGoogle, signOut } =
    useAuth()
  if (!configured) {
    return (
      <div className="gate">
        <div className="panel">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="GlobalNetwork" width={84} height={84} />
          <h1>POS not configured</h1>
          <p className="muted">This GitHub Pages build is missing Firebase keys.</p>
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="gate">
        <div className="panel glow">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="GlobalNetwork" width={84} height={84} className="spin" />
          <p className="eyebrow">GlobalNetwork · Antigua</p>
          <h1>Field POS</h1>
          <p className="muted">Staff sign-in required. Opening…</p>
        </div>
      </div>
    )
  }
  if (!user) return <Login signIn={signIn} signInWithGoogle={signInWithGoogle} />
  if (linking && !canPos) {
    return (
      <div className="gate">
        <div className="panel glow">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="GlobalNetwork" width={84} height={84} className="spin" />
          <p className="eyebrow">GlobalNetwork · Antigua</p>
          <h1>Field POS</h1>
          <p className="muted">Checking your cashier role…</p>
        </div>
      </div>
    )
  }
  if (!canPos) {
    return (
      <div className="gate">
        <div className="panel">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" width={64} height={64} />
          <p className="eyebrow">GlobalNetwork · Antigua</p>
          <h1>{deskRole === 'pending' ? 'Waiting for approval' : 'This POS is for cashiers and owners'}</h1>
          <p className="muted">
            {linkError ||
              `${user.email} cannot collect. Only an approved cashier, owner, or manager can use field POS.`}
          </p>
          <button className="btn ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return (
    <PosShell
      email={user.email || member?.email || ''}
      name={member?.name || user.displayName || ''}
      role={deskRole}
      outletIds={member?.outletIds ?? []}
      canExtend={deskRole === 'owner' || deskRole === 'manager'}
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
  return (
    <div className="gate">
      <form className="panel glow" onSubmit={(e) => void submit(e)}>
        <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="GlobalNetwork" width={84} height={84} className="spin" />
        <p className="eyebrow">GlobalNetwork · Antigua</p>
        <h1>Field POS</h1>
        <p className="muted">Sign in with your GlobalNetwork staff account. Only cashiers, owners, and managers can collect.</p>
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="fail">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void signInWithGoogle()
              .catch((err) => setError(googleAuthErrorMessage(err)))
              .finally(() => setBusy(false))
          }}
        >
          Continue with Google
        </button>
      </form>
    </div>
  )
}

function PosShell({
  email,
  name,
  role,
  outletIds,
  canExtend,
  signOut,
}: {
  email: string
  name: string
  role: string | null
  outletIds: string[]
  canExtend: boolean
  signOut: () => Promise<void>
}) {
  const [outlets, setOutlets] = useState<PosOutlet[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [site, setSite] = useState<Site | null>(() => readSite())
  const [screen, setScreen] = useState<Screen>(() => (readSite() ? 'search' : 'location'))
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Customer | null>(null)
  const [amount, setAmount] = useState('')
  const [days, setDays] = useState('30')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [now, setNow] = useState(Date.now())
  const [addName, setAddName] = useState('')

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (canExtend) void repo.seedDefaultPosOutlets().catch(() => undefined)
    const u1 = repo.observePosOutlets(setOutlets)
    const u2 = repo.observeCustomers('globalnetwork', setCustomers)
    return () => {
      u1()
      u2()
    }
  }, [canExtend])

  const allowed = useMemo(() => {
    const active = outlets.filter((o) => !o.disabled)
    if (role === 'cashier' && outletIds.length) return active.filter((o) => outletIds.includes(o.id))
    return active
  }, [outlets, role, outletIds])

  useEffect(() => {
    if (site && allowed.length && !allowed.some((o) => o.id === site.id)) {
      setSite(null)
      setScreen('location')
    }
  }, [allowed, site])

  const chooseSite = (next: Site) => {
    localStorage.setItem(LOC_KEY, JSON.stringify(next))
    setSite(next)
    setScreen('search')
    setPicked(null)
  }

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers
      .filter((c) => `${c.name} ${c.phone} ${c.email} ${c.address}`.toLowerCase().includes(q))
      .slice(0, 12)
  }, [customers, query])

  const live = picked ? customers.find((c) => c.id === picked.id) ?? picked : null
  const left = live ? Math.max(0, daysLeft(live.paidUntilMs, now)) : 0

  const keypad = (key: string) => {
    if (key === 'C') {
      setAmount('')
      return
    }
    if (key === '⌫') {
      setAmount((v) => v.slice(0, -1))
      return
    }
    if (key === '.' && amount.includes('.')) return
    setAmount((v) => (v === '0' && key !== '.' ? key : `${v}${key}`))
  }

  const fullCycle = () => {
    if (!live) return
    setDays(String(live.planDays || 30))
    setAmount(String(live.feeAmount || live.balanceDue || ''))
  }

  const collect = async () => {
    if (!live || !site) return
    const paid = Number(amount)
    const grant = Math.floor(Number(days))
    if (!Number.isFinite(paid) || paid < 0) {
      setErr('Enter the EC$ amount paid.')
      return
    }
    if (!Number.isFinite(grant) || grant < 1) {
      setErr('Enter days to grant.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await repo.extendSubscription({
        customerId: live.id,
        days: grant,
        amountPaid: paid,
        note,
        locationId: site.id,
        locationName: site.name,
      })
      setReceipt({
        customerName: live.name,
        amount: paid,
        days: grant,
        paidUntilMs: res.paidUntilMs,
        balanceDue: res.balanceDue,
        locationName: site.name,
        atMs: Date.now(),
        kind: 'collect',
      })
      setScreen('receipt')
      setNote('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Collection failed')
    } finally {
      setBusy(false)
    }
  }

  const extend = async () => {
    if (!live || !site) return
    const grant = Math.floor(Number(days))
    if (!Number.isFinite(grant) || grant < 1) {
      setErr('Enter days to extend.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await repo.grantDayExtension({
        customerId: live.id,
        days: grant,
        note,
        locationId: site.id,
        locationName: site.name,
      })
      setReceipt({
        customerName: live.name,
        amount: 0,
        days: res.daysGranted,
        paidUntilMs: res.paidUntilMs,
        balanceDue: res.balanceDue,
        locationName: site.name,
        atMs: Date.now(),
        kind: 'extend',
        balanceAdded: res.balanceAdded,
      })
      setScreen('receipt')
      setNote('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Extend failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos">
      <header className="top">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" />
          <div>
            <strong>GlobalNetwork · Antigua</strong>
            <div className="muted tiny">Field POS · EC$ / XCD</div>
          </div>
        </div>
        {site && (
          <button className="loc-chip" type="button" onClick={() => setScreen('location')}>
            {site.name}
          </button>
        )}
        <div className="who">
          <span>
            {name || email}
            <em>{role}</em>
          </span>
          <button className="btn ghost small" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {err && <p className="fail banner">{err}</p>}

      {screen === 'location' && (
        <section className="stage">
          <p className="eyebrow">Session location</p>
          <h1>Where are you collecting?</h1>
          <p className="muted">Every payment is written to the customer ledger with this site name.</p>
          <div className="sites">
            {allowed.map((o) => (
              <button key={o.id} className={`site ${site?.id === o.id ? 'on' : ''}`} type="button" onClick={() => chooseSite({ id: o.id, name: o.name })}>
                {o.name}
              </button>
            ))}
          </div>
          {canExtend && (
            <form
              className="add-site"
              onSubmit={(e) => {
                e.preventDefault()
                void (async () => {
                  setBusy(true)
                  setErr(null)
                  try {
                    const id = await repo.savePosOutlet({ name: addName })
                    chooseSite({ id, name: addName.trim() })
                    setAddName('')
                  } catch (e2) {
                    setErr(e2 instanceof Error ? e2.message : 'Could not add location')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Add location" required />
              <button className="btn ghost" type="submit" disabled={busy}>
                Add
              </button>
            </form>
          )}
        </section>
      )}

      {screen === 'search' && site && (
        <section className="stage">
          <p className="eyebrow">{site.name}</p>
          <h1>Find a customer</h1>
          <input
            className="search"
            autoFocus
            placeholder="Name, phone, or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="hits">
            {hits.map((c) => {
              const d = Math.max(0, daysLeft(c.paidUntilMs, now))
              return (
                <button
                  key={c.id}
                  className="hit"
                  type="button"
                  onClick={() => {
                    setPicked(c)
                    setDays(String(c.planDays || 30))
                    setAmount(c.balanceDue > 0 ? String(c.balanceDue) : String(c.feeAmount || ''))
                    setScreen('pay')
                    setErr(null)
                  }}
                >
                  <strong>{c.name || 'Unnamed'}</strong>
                  <span className="muted">
                    {c.phone || c.email || 'No contact'} · {c.planName || 'No plan'}
                  </span>
                  <b className={`days ${d <= 0 ? 'off' : d <= 3 ? 'warn' : ''}`}>{d}d</b>
                </button>
              )
            })}
            {hits.length === 0 && <p className="muted">No matches.</p>}
          </div>
        </section>
      )}

      {screen === 'pay' && live && site && (
        <section className="pay">
          <button className="back" type="button" onClick={() => setScreen('search')}>
            ← Search
          </button>
          <div className="pay-grid">
            <article className="cust">
              <p className="eyebrow">{live.status}</p>
              <h2>{live.name}</h2>
              <p className="muted">
                {live.phone || live.email || 'No contact'}
                {live.planName ? ` · ${live.planName}` : ''}
              </p>
              <div className={`pulse ${left <= 0 ? 'off' : left <= 3 ? 'warn' : ''}`}>
                <b>{left}</b>
                <span>days left</span>
              </div>
              <ul className="facts">
                <li>
                  <span>Balance due</span>
                  <strong>{formatEc(live.balanceDue)}</strong>
                </li>
                <li>
                  <span>Plan fee</span>
                  <strong>{formatEc(live.feeAmount)}</strong>
                </li>
                <li>
                  <span>Paid until</span>
                  <strong>{fmtDate(live.paidUntilMs)}</strong>
                </li>
              </ul>
            </article>
            <article className="till">
              <p className="currency">EC$</p>
              <div className="amount">{amount || '0'}</div>
              <div className="keys">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
                  <button key={k} type="button" onClick={() => keypad(k)}>
                    {k}
                  </button>
                ))}
                <button type="button" className="wide" onClick={() => keypad('C')}>
                  Clear
                </button>
              </div>
              <div className="quick">
                {QUICK.map((n) => (
                  <button key={n} type="button" onClick={() => setAmount(String(n))}>
                    {n}
                  </button>
                ))}
              </div>
              <label className="days-in">
                Days to grant
                <input value={days} onChange={(e) => setDays(e.target.value)} />
              </label>
              <button className="btn ghost" type="button" onClick={fullCycle}>
                Full cycle · {live.planDays || 30}d · {formatEc(live.feeAmount)}
              </button>
              <input className="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
              <button className="btn primary huge" type="button" disabled={busy} onClick={() => void collect()}>
                {busy ? 'Posting…' : `Collect ${formatEc(Number(amount) || 0)}`}
              </button>
              {canExtend && (
                <button className="btn ghost" type="button" disabled={busy} onClick={() => void extend()}>
                  Extend {days || '—'}d · no cash · {formatEc((Math.floor(Number(days)) || 0) * DAY_EXTENSION_RATE_XCD)} on
                  balance
                </button>
              )}
              <p className="muted tiny">
                Collect posts cash via extendSubscription. Extend adds EC${DAY_EXTENSION_RATE_XCD}/day to what they owe —
                it is not paid-in.
              </p>
            </article>
          </div>
        </section>
      )}

      {screen === 'receipt' && receipt && (
        <section className="stage receipt-wrap">
          <article className="receipt" id="gn-receipt">
            <img src={`${import.meta.env.BASE_URL}logo-gn.png`} alt="" width={48} height={48} />
            <p className="eyebrow">GlobalNetwork · Antigua</p>
            <h1>{receipt.kind === 'collect' ? 'Payment received' : 'Days extended'}</h1>
            <p className="big">{receipt.kind === 'collect' ? formatEc(receipt.amount) : `${receipt.days} days`}</p>
            <ul>
              <li>
                <span>Customer</span>
                <b>{receipt.customerName}</b>
              </li>
              <li>
                <span>Days granted</span>
                <b>{receipt.days}</b>
              </li>
              <li>
                <span>Paid until</span>
                <b>{fmtDate(receipt.paidUntilMs)}</b>
              </li>
              <li>
                <span>Balance remaining</span>
                <b>{formatEc(receipt.balanceDue)}</b>
              </li>
              {receipt.kind === 'extend' && (
                <li>
                  <span>Added to balance</span>
                  <b>{formatEc(receipt.balanceAdded || 0)}</b>
                </li>
              )}
              <li>
                <span>Location</span>
                <b>{receipt.locationName}</b>
              </li>
              <li>
                <span>Time</span>
                <b>{new Date(receipt.atMs).toLocaleString()}</b>
              </li>
              <li>
                <span>Collector</span>
                <b>{email}</b>
              </li>
            </ul>
          </article>
          <div className="receipt-actions">
            <button className="btn primary" type="button" onClick={() => window.print()}>
              Print
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setScreen('search')
                setPicked(null)
                setReceipt(null)
                setQuery('')
                setAmount('')
              }}
            >
              Done
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
