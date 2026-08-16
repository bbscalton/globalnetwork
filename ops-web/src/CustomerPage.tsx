import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { ChatMessage, Customer, IssueTicket, Payment, Plan } from './lib/types'
import * as repo from './lib/repo'
import { cyclePct, fmtDate, fmtWhen, initials, statusTone } from './lib/desk'

export function CustomerPage({
  customers,
  plans,
  issues,
  now,
}: {
  customers: Customer[]
  plans: Plan[]
  issues: IssueTicket[]
  now: number
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const customer = customers.find((c) => c.id === id)
  const [payments, setPayments] = useState<Payment[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [days, setDays] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const u1 = repo.observePayments(id, setPayments)
    const u2 = repo.observeChat(id, setMessages)
    return () => {
      u1()
      u2()
    }
  }, [id])

  useEffect(() => {
    if (!customer) return
    setDays(String(customer.planDays || 30))
    setAmount(customer.balanceDue > 0 ? String(customer.balanceDue) : String(customer.feeAmount || ''))
  }, [customer?.id, customer?.planDays, customer?.feeAmount, customer?.balanceDue])

  const relatedIssues = useMemo(() => issues.filter((i) => i.customerId === id), [issues, id])

  if (!id) return <Navigate to="/" replace />
  if (customers.length > 0 && !customer) {
    return (
      <div className="desk">
        <p className="fail">This customer is not on the desk.</p>
        <Link to="/">Back to roster</Link>
      </div>
    )
  }
  if (!customer) return <p className="muted">Loading record…</p>

  const left = repo.daysLeft(customer.paidUntilMs, now)
  const pct = cyclePct(customer, now)

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      setMsg(await work())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const extend = (useDays: number, paid: number, text: string) =>
    run(async () => {
      const res = await repo.extendSubscription({
        customerId: customer.id,
        days: useDays,
        amountPaid: paid,
        note: text,
      })
      setNote('')
      return `Service through ${fmtDate(res.paidUntilMs)} · ${res.status} · balance ${repo.formatGyd(res.balanceDue)}`
    })

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    const text = draft.trim()
    setDraft('')
    await repo.sendChat(customer.id, text, 'staff')
  }

  const assignPlan = async (planId: string) => {
    const plan = plans.find((p) => p.id === planId)
    if (!plan) return
    await repo.updateCustomerContact(customer.id, {
      planId: plan.id,
      planName: plan.name,
      planDays: plan.days,
      feeAmount: plan.feeAmount,
    })
    setMsg(`Assigned ${plan.name}. Grant days to put them on-network.`)
  }

  return (
    <div className="record">
      <button className="back" type="button" onClick={() => navigate('/')}>
        ← Roster
      </button>
      <header className="record-hero">
        <span className="avatar xl">{initials(customer.name)}</span>
        <div className="record-id">
          <p className="eyebrow">{customer.planName || 'No package'}</p>
          <h1>{customer.name}</h1>
          <p className="muted">
            {customer.phone || 'No phone'} · {customer.email || 'No email'}
            <br />
            {customer.address || 'No site address'}
          </p>
        </div>
        <div className="record-status">
          <span className={`pill ${statusTone(customer.status)}`}>{customer.status}</span>
          <p className="days-left">{left > 0 ? `${left} days left` : 'Off network'}</p>
          <p className="muted tiny">Paid until {fmtDate(customer.paidUntilMs)}</p>
        </div>
      </header>

      <div className="cycle-hero">
        <div className="cycle-hero-top">
          <span>Current cycle</span>
          <span>
            {pct}% remaining · balance {repo.formatGyd(customer.balanceDue)}
          </span>
        </div>
        <div className="cycle-track lg">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      <section className="card action-card">
        <div className="card-head">
          <h2>Renew or collect</h2>
          <span className="muted tiny">extendSubscription — days first, amount second</span>
        </div>
        <div className="quick-renew">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void extend(customer.planDays || 30, customer.feeAmount, 'Full plan renewal')}
          >
            Collect full {customer.planDays || 30}d · {repo.formatGyd(customer.feeAmount)}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => void extend(7, Number(amount || 0), note || 'Seven-day top-up')}
          >
            Grant 7 days
          </button>
          {customer.status !== 'suspended' && (
            <button className="btn btn-ghost danger" type="button" disabled={busy} onClick={() => void run(async () => {
              await repo.suspendCustomer(customer.id)
              return 'Service suspended'
            })}>
              Suspend
            </button>
          )}
        </div>
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <label>
            Days to grant
            <input value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label>
            Amount paid (GYD)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Waiting on rest of fee" />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void extend(Number(days), Number(amount || 0), note)}
          >
            Apply
          </button>
        </div>
      </section>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <label>
            Package
            <select value={customer.planId} onChange={(e) => void assignPlan(e.target.value)}>
              <option value="">Unassigned</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.days}d · {repo.formatGyd(p.feeAmount)} {p.active ? '' : '(hidden)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Address / site
            <input
              defaultValue={customer.address}
              key={`${customer.id}-address`}
              onBlur={(e) => {
                const address = e.target.value.trim()
                if (address !== customer.address) void repo.updateCustomerContact(customer.id, { address })
              }}
            />
          </label>
          <label>
            Phone
            <input
              defaultValue={customer.phone}
              key={`${customer.id}-phone`}
              onBlur={(e) => {
                const phone = e.target.value.trim()
                if (phone !== customer.phone) void repo.updateCustomerContact(customer.id, { phone })
              }}
            />
          </label>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Payment ledger</h2>
          </div>
          {payments.length === 0 && <p className="muted">No payments yet. The first extend writes the ledger.</p>}
          <ul className="ledger">
            {payments.map((p) => (
              <li key={p.id}>
                <span>
                  <strong>{repo.formatGyd(p.amount)}</strong> · {p.kind} · {p.daysGranted}d
                  {p.note ? <span className="muted"> — {p.note}</span> : null}
                </span>
                <span className="muted tiny">{fmtWhen(p.atMs)}</span>
              </li>
            ))}
            {payments.length === 0 && customer.paidAmount > 0 && (
              <li>
                <span>
                  Lifetime collected <strong>{repo.formatGyd(customer.paidAmount)}</strong>
                </span>
              </li>
            )}
          </ul>
        </section>
      </div>

      <div className="split">
        <section className="card chat-card">
          <div className="card-head">
            <h2>Thread</h2>
            <Link to={`/chat?c=${customer.id}`}>Open inbox</Link>
          </div>
          <div className="thread">
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.from}`}>
                <span className="muted tiny">{m.from === 'staff' ? 'Desk' : 'Customer'} · {fmtWhen(m.createdAtMs)}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {messages.length === 0 && <p className="muted">No messages yet.</p>}
          </div>
          <form className="composer" onSubmit={(e) => void send(e)}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message this customer…" />
            <button className="btn btn-primary" type="submit">
              Send
            </button>
          </form>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Tickets</h2>
          </div>
          {relatedIssues.length === 0 && <p className="muted">No line issues on this account.</p>}
          {relatedIssues.map((issue) => (
            <article key={issue.id} className="ticket">
              <span className={`pill ${issue.status === 'resolved' ? 'ok' : issue.status === 'open' ? 'fail' : 'warn'}`}>{issue.status}</span>
              <h3>{issue.title}</h3>
              <p className="muted tiny">{fmtWhen(issue.createdAtMs)}</p>
              <p>{issue.body}</p>
              <div className="chips" style={{ marginTop: 8 }}>
                {(['open', 'in_progress', 'resolved'] as const).map((status) => (
                  <button
                    key={status}
                    className={`chip ${issue.status === status ? 'is-on' : ''}`}
                    type="button"
                    onClick={() => void repo.setIssueStatus(customer.id, issue.id, status)}
                  >
                    {status.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
