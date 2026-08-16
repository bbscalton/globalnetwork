import { useEffect, useMemo, useState } from 'react'
import type { Customer, Plan } from './types'
import { createCustomer, daysLeft, extendSubscription, formatGyd, suspendCustomer, updateCustomerContact } from './repo'

function fmtDate(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function AccountsPanel({
  customers,
  plans,
  nowTick,
  busy,
  onBusy,
  onStatus,
  onError,
}: {
  customers: Customer[]
  plans: Plan[]
  nowTick: number
  busy: boolean
  onBusy: (v: boolean) => void
  onStatus: (msg: string) => void
  onError: (msg: string | null) => void
}) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', planId: '' })
  const [extendDays, setExtendDays] = useState('7')
  const [amountPaid, setAmountPaid] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (selected) {
      const fresh = customers.find((c) => c.id === selected.id)
      if (fresh) setSelected(fresh)
    }
  }, [customers, selected])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((c) => `${c.name} ${c.phone} ${c.email} ${c.status}`.toLowerCase().includes(term))
  }, [customers, q])

  const onCreate = async () => {
    onBusy(true)
    onError(null)
    try {
      const res = await createCustomer(form)
      onStatus(`Created customer ${form.name} (${res.customerId}).`)
      setCreating(false)
      setForm({ name: '', phone: '', email: '', address: '', planId: '' })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      onBusy(false)
    }
  }

  const onExtend = async () => {
    if (!selected) return
    onBusy(true)
    onError(null)
    try {
      const res = await extendSubscription({
        customerId: selected.id,
        days: Number(extendDays),
        amountPaid: Number(amountPaid || 0),
        note,
      })
      onStatus(
        `Extended ${selected.name} by ${extendDays} day(s) until ${new Date(res.paidUntilMs).toLocaleDateString()}. Status: ${res.status}. Balance: ${formatGyd(res.balanceDue)}.`,
      )
      setNote('')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Extend failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="tcd-card tcd-card-wide">
      <div className="tcd-card-head">
        <h2>Fleet</h2>
        <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>
          New customer
        </button>
      </div>
      <p className="muted small" style={{ marginTop: '-0.4rem', marginBottom: '1rem' }}>
        Day-to-day renewals, collections, and chat live in the Customer desk. This is a control-plane snapshot of
        who is on the network.
      </p>
      <input
        placeholder="Search name, phone, email…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginBottom: '1rem', padding: '0.7rem 0.9rem', borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: '#fff' }}
      />
      <div className="tcd-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Paid until</th>
              <th>Days</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => setSelected(c)} style={{ cursor: 'pointer' }}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted small">{c.phone || c.email}</div>
                </td>
                <td>{c.planName || '—'}</td>
                <td>
                  <span className={`pill tcd-${c.status === 'active' ? 'ok' : c.status === 'grace' ? 'warn' : 'fail'}`}>
                    {c.status}
                  </span>
                </td>
                <td>{fmtDate(c.paidUntilMs)}</td>
                <td>{daysLeft(c.paidUntilMs, nowTick)}</td>
                <td>{formatGyd(c.balanceDue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="tcd-empty-note">No customers yet.</p>}
      </div>

      {creating && (
        <div className="tcd-modal-backdrop" onClick={() => setCreating(false)}>
          <div className="tcd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>New customer</h3>
            <div className="tcd-form-grid">
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                Email
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <label>
                Address
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label>
                Plan
                <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                  <option value="">Select…</option>
                  {plans.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.days}d · {formatGyd(p.feeAmount)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tcd-modal-actions">
              <button className="btn btn-ghost-on-dark" type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" disabled={busy || !form.name} onClick={() => void onCreate()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="tcd-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="tcd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.name}</h3>
            <p className="muted small">
              {selected.phone} · {selected.email}
              <br />
              {selected.address}
            </p>
            <p style={{ marginTop: '0.8rem' }}>
              {selected.planName} · paid until {fmtDate(selected.paidUntilMs)} · balance {formatGyd(selected.balanceDue)}
            </p>
            <div className="tcd-form-grid" style={{ marginTop: '1rem' }}>
              <label>
                Extend days
                <input value={extendDays} onChange={(e) => setExtendDays(e.target.value)} />
              </label>
              <label>
                Amount paid (GYD)
                <input value={amountPaid} placeholder={String(selected.feeAmount)} onChange={(e) => setAmountPaid(e.target.value)} />
              </label>
              <label>
                Note
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Partial payment, waiting on rest of fee" />
              </label>
              <label>
                Address
                <input
                  defaultValue={selected.address}
                  onBlur={(e) => {
                    const address = e.target.value.trim()
                    if (address !== selected.address) void updateCustomerContact(selected.id, { address })
                  }}
                />
              </label>
            </div>
            <div className="tcd-modal-actions">
              <button
                className="btn btn-ghost-on-dark"
                type="button"
                disabled={busy}
                onClick={() => void suspendCustomer(selected.id).then(() => onStatus(`Suspended ${selected.name}`)).catch((e) => onError(e.message))}
              >
                Suspend
              </button>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void onExtend()}>
                Extend service
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
