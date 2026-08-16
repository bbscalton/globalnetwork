import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer, CustomerStatus, IssueTicket, Plan } from './lib/types'
import * as repo from './lib/repo'
import { cyclePct, deskPulse, fmtDate, initials, statusTone } from './lib/desk'
import { ONLINE_AFTER_MS } from './lib/firebase'

type Filter = 'all' | CustomerStatus | 'due' | 'owed'

export function Board({
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
  const navigate = useNavigate()
  const pulse = useMemo(() => deskPulse(customers, issues, now, ONLINE_AFTER_MS), [customers, issues, now])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', planId: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return customers.filter((c) => {
      if (filter === 'due') {
        const left = repo.daysLeft(c.paidUntilMs, now)
        if (!(left > 0 && left <= 3)) return false
      } else if (filter === 'owed') {
        if (!((c.balanceDue || 0) > 0 || c.status === 'grace')) return false
      } else if (filter !== 'all' && c.status !== filter) {
        return false
      }
      if (!term) return true
      return `${c.name} ${c.phone} ${c.email} ${c.planName} ${c.address}`.toLowerCase().includes(term)
    })
  }, [customers, q, filter, now])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await repo.createCustomer(form)
      setCreating(false)
      setForm({ name: '', phone: '', email: '', address: '', planId: '' })
      navigate(`/c/${res.customerId}`)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not create customer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Today on the network</p>
          <h1>Owner desk</h1>
          <p className="muted">
            Onboard a subscriber, collect a partial fee, or grant extra days when they cannot pay the full amount.
          </p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>
          New customer
        </button>
      </header>

      <section className="queue-grid" aria-label="Work queues">
        <button className="queue-card gn-glow" type="button" onClick={() => setFilter('due')}>
          <span className="queue-label">Renewals · 3 days</span>
          <strong className="count-pop">{pulse.dueSoon.length}</strong>
          <span className="muted">{pulse.dueSoon[0]?.name ?? 'Nobody due yet'}</span>
        </button>
        <button className="queue-card gn-glow" type="button" onClick={() => setFilter('owed')}>
          <span className="queue-label">Collections</span>
          <strong className="count-pop">{pulse.collections.length}</strong>
          <span className="muted">{repo.formatEc(pulse.collections.reduce((s, c) => s + (c.balanceDue || 0), 0))} outstanding</span>
        </button>
        <button className="queue-card gn-glow" type="button" onClick={() => navigate('/chat')}>
          <span className="queue-label">Unread chat</span>
          <strong className={`count-pop ${pulse.unread.length ? 'gn-pulse' : ''}`}>{pulse.unread.length}</strong>
          <span className="muted">{pulse.unread[0]?.name ?? 'Inbox is clear'}</span>
        </button>
        <button className="queue-card gn-glow" type="button" onClick={() => navigate('/issues')}>
          <span className="queue-label">Open tickets</span>
          <strong className="count-pop">{pulse.openIssues}</strong>
          <span className="muted">{pulse.offline.length} active without a recent heartbeat</span>
        </button>
      </section>

      <div className="desk-toolbar">
        <input className="search" placeholder="Search name, phone, email, address, plan…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {(
            [
              ['all', 'All'],
              ['active', 'Live'],
              ['grace', 'Grace'],
              ['expired', 'Expired'],
              ['suspended', 'Suspended'],
              ['due', 'Due soon'],
              ['owed', 'Owes'],
            ] as Array<[Filter, string]>
          ).map(([id, label]) => (
            <button key={id} type="button" className={`chip ${filter === id ? 'is-on' : ''}`} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card table-card">
        <table className="roster">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Service</th>
              <th>Cycle</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const left = repo.daysLeft(c.paidUntilMs, now)
              return (
                <tr key={c.id} className="roster-row" onClick={() => navigate(`/c/${c.id}`)}>
                  <td>
                    <div className="who">
                      <span className="avatar">{initials(c.name)}</span>
                      <span>
                        <strong>{c.name}</strong>
                        <div className="muted tiny">{c.phone || c.email || c.address || 'No contact yet'}</div>
                      </span>
                    </div>
                  </td>
                  <td>{c.planName || 'Unassigned'}</td>
                  <td>
                    <span className={`pill ${statusTone(c.status)}`}>{c.status}</span>
                    {(c.unreadStaff ?? 0) > 0 && <span className="dot-unread" title="Unread chat" />}
                  </td>
                  <td>
                    <div className="cycle">
                      <div className="cycle-track glow-bar" aria-hidden="true">
                        <span style={{ width: `${cyclePct(c, now)}%` }} />
                      </div>
                      <span className="muted tiny">
                        {left > 0 ? `${left}d left` : 'Off network'} · {fmtDate(c.paidUntilMs)}
                      </span>
                    </div>
                  </td>
                  <td className={c.balanceDue > 0 ? 'warn-text' : ''}>{repo.formatEc(c.balanceDue)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No customers match this view.</p>}
      </div>

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void onCreate(e)}>
            <p className="eyebrow">Onboard</p>
            <h2>New customer</h2>
            <p className="muted">They start expired until you grant days on their record. Assign a selling plan now.</p>
            <label>
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Phone
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Address / site
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label>
              Plan
              <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                <option value="">Select a package</option>
                {plans.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.days}d · {repo.formatEc(p.feeAmount)}
                  </option>
                ))}
              </select>
            </label>
            {msg && <p className="fail">{msg}</p>}
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !form.name.trim()}>
                {busy ? 'Creating…' : 'Create record'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
