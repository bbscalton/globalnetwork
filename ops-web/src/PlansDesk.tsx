import { useMemo, useState } from 'react'
import type { Customer, Plan } from './lib/types'
import { daysLeft, deletePlan, ensureOrgDefaults, formatEc, savePlan } from './lib/repo'

type PlanDraft = { name: string; days: string; feeAmount: string }

export function PlansDesk({
  plans,
  customers,
  now,
  renewalWarnDays = 3,
}: {
  plans: Plan[]
  customers: Customer[]
  now: number
  renewalWarnDays?: number
}) {
  const [name, setName] = useState('30-day home')
  const [days, setDays] = useState('30')
  const [feeAmount, setFeeAmount] = useState('4000')
  const [editing, setEditing] = useState<Record<string, PlanDraft>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const mix = useMemo(() => {
    const total = Math.max(customers.length, 1)
    return [...plans]
      .sort((a, b) => a.days - b.days)
      .map((plan) => {
        const members = customers.filter((c) => c.planId === plan.id)
        const live = members.filter((c) => c.status === 'active' || c.status === 'grace')
        const dueSoon = members.filter((c) => {
          const left = daysLeft(c.paidUntilMs, now)
          return left > 0 && left <= renewalWarnDays
        })
        const owed = members.reduce((sum, c) => sum + (c.balanceDue || 0), 0)
        const booked = live.length * plan.feeAmount
        return {
          plan,
          members,
          live: live.length,
          dueSoon: dueSoon.length,
          owed,
          booked,
          share: Math.round((members.length / total) * 100),
          daily: plan.days > 0 ? Math.round(plan.feeAmount / plan.days) : 0,
        }
      })
  }, [plans, customers, now, renewalWarnDays])

  const kpis = useMemo(() => {
    const livePlans = mix.filter((row) => row.plan.active)
    return {
      packages: livePlans.length,
      subscribers: customers.length,
      booked: mix.reduce((sum, row) => sum + row.booked, 0),
      owed: mix.reduce((sum, row) => sum + row.owed, 0),
    }
  }, [mix, customers.length])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      setMsg(await work())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const save = (plan: Partial<Plan> & { name: string; days: number; feeAmount: number }) =>
    run(async () => {
      await savePlan({
        id: plan.id,
        name: plan.name,
        days: plan.days,
        feeAmount: plan.feeAmount,
        currency: 'XCD',
        active: plan.active ?? true,
      })
      if (plan.id) {
        setEditing((prev) => {
          const next = { ...prev }
          delete next[plan.id as string]
          return next
        })
      }
      return `Saved ${plan.name}.`
    })

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Plans</h1>
          <p className="muted">Price 15 / 30 / 90-day cycles. Existing balances stay until the next extend.</p>
        </div>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {
            await ensureOrgDefaults()
            return 'Starter 15 / 30 / 90-day plans are in the catalog.'
          })}
        >
          Seed defaults
        </button>
      </header>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      <section className="queue-grid" aria-label="Plan pulse">
        <article className="queue-card">
          <span className="queue-label">Selling</span>
          <strong className="count-pop">{kpis.packages}</strong>
          <span className="muted">{plans.length} in catalog</span>
        </article>
        <article className="queue-card">
          <span className="queue-label">Subscribers</span>
          <strong className="count-pop">{kpis.subscribers}</strong>
          <span className="muted">On any package</span>
        </article>
        <article className="queue-card">
          <span className="queue-label">Booked cycle</span>
          <strong className="count-pop">{formatEc(kpis.booked)}</strong>
          <span className="muted">Active + grace × fee</span>
        </article>
        <article className="queue-card">
          <span className="queue-label">To collect</span>
          <strong className={`count-pop ${kpis.owed > 0 ? 'warn-text' : ''}`}>{formatEc(kpis.owed)}</strong>
          <span className="muted">Plan due + extension balances</span>
        </article>
      </section>

      <div className="card">
        {mix.length === 0 ? (
          <p className="muted">No packages yet. Seed defaults or add a plan below.</p>
        ) : (
          <div className="plan-mix">
            {mix.map((row) => (
              <div key={row.plan.id} className="plan-mix-row">
                <div>
                  <strong>{row.plan.name}</strong>
                  <span className="muted tiny">
                    {' '}
                    {row.members.length} customer{row.members.length === 1 ? '' : 's'} · {row.share}%
                  </span>
                </div>
                <div className="cycle-track" aria-hidden="true">
                  <span className={row.plan.active ? '' : 'is-off'} style={{ width: `${Math.max(row.share, row.members.length ? 6 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="plan-grid">
        {mix.map((row) => {
          const draft = editing[row.plan.id]
          const remainingBar = row.plan.days
            ? Math.min(
                100,
                Math.round(
                  (row.members.reduce((s, c) => s + Math.max(0, daysLeft(c.paidUntilMs, now)), 0) /
                    Math.max(row.members.length * row.plan.days, 1)) *
                    100,
                ),
              )
            : 0
          return (
            <article key={row.plan.id} className={`card plan-card ${row.plan.active ? '' : 'is-hidden'}`}>
              <header className="card-head">
                <p className="eyebrow">{row.plan.days}-day cycle</p>
                <span className={`pill ${row.plan.active ? 'ok' : 'warn'}`}>{row.plan.active ? 'Selling' : 'Hidden'}</span>
              </header>
              {draft ? (
                <div className="form-row">
                  <label>
                    Name
                    <input value={draft.name} onChange={(e) => setEditing((prev) => ({ ...prev, [row.plan.id]: { ...draft, name: e.target.value } }))} />
                  </label>
                  <label>
                    Days
                    <input value={draft.days} onChange={(e) => setEditing((prev) => ({ ...prev, [row.plan.id]: { ...draft, days: e.target.value } }))} />
                  </label>
                  <label>
                    Fee (EC$)
                    <input
                      value={draft.feeAmount}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [row.plan.id]: { ...draft, feeAmount: e.target.value } }))}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <h2>{row.plan.name}</h2>
                  <p className="plan-price">{formatEc(row.plan.feeAmount)}</p>
                  <p className="muted tiny">EC${row.daily.toLocaleString()} per day of service</p>
                </>
              )}
              <div className="cycle-hero">
                <div className="cycle-hero-top">
                  <span>{row.live} live</span>
                  <span>{remainingBar}% of granted days remaining</span>
                </div>
                <div className="cycle-track lg">
                  <span style={{ width: `${remainingBar}%` }} />
                </div>
              </div>
              <ul className="ledger">
                <li>
                  <span>
                    <strong>{row.members.length}</strong> on this plan
                  </span>
                </li>
                <li>
                  <span>
                    <strong>{row.dueSoon}</strong> due in {renewalWarnDays} days
                  </span>
                </li>
                <li>
                  <span>
                    <strong>{formatEc(row.owed)}</strong> balance due
                  </span>
                </li>
              </ul>
              <div className="quick-renew">
                {draft ? (
                  <>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void save({
                          ...row.plan,
                          name: draft.name.trim(),
                          days: Number(draft.days),
                          feeAmount: Number(draft.feeAmount),
                        })
                      }
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() =>
                        setEditing((prev) => {
                          const next = { ...prev }
                          delete next[row.plan.id]
                          return next
                        })
                      }
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() =>
                      setEditing((prev) => ({
                        ...prev,
                        [row.plan.id]: {
                          name: row.plan.name,
                          days: String(row.plan.days),
                          feeAmount: String(row.plan.feeAmount),
                        },
                      }))
                    }
                  >
                    Edit price / days
                  </button>
                )}
                <button
                  className="btn btn-ghost danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const assigned = row.members.length
                    if (assigned > 0) {
                      if (
                        !window.confirm(
                          `${row.plan.name} is assigned to ${assigned} customer${assigned === 1 ? '' : 's'}. Unassign them and delete this plan?`,
                        )
                      ) {
                        return
                      }
                      void run(async () => {
                        await deletePlan(row.plan.id, true)
                        return `Deleted ${row.plan.name} and unassigned ${assigned} customer${assigned === 1 ? '' : 's'}.`
                      })
                      return
                    }
                    if (!window.confirm(`Delete ${row.plan.name}?`)) return
                    void run(async () => {
                      await deletePlan(row.plan.id, false)
                      return `Deleted ${row.plan.name}.`
                    })
                  }}
                >
                  Delete
                </button>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void save({ ...row.plan, active: !row.plan.active })}>
                  {row.plan.active ? 'Stop selling' : 'Start selling'}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>New package</h2>
        </div>
        <div className="form-row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="30-day home" />
          </label>
          <label>
            Cycle length (days)
            <input value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label>
            Fee (EC$)
            <input value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
          </label>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !name.trim()}
          style={{ marginTop: '1rem' }}
          onClick={() => void save({ name: name.trim(), days: Number(days), feeAmount: Number(feeAmount), active: true })}
        >
          Add to catalog
        </button>
      </section>
    </div>
  )
}
