import { useMemo, useState } from 'react'
import type { Customer, Plan } from './types'
import { daysLeft, formatGyd, savePlan } from './repo'

type PlanDraft = { name: string; days: string; feeAmount: string }

export function PlansPanel({
  plans,
  customers,
  nowTick,
  busy,
  onBusy,
  onStatus,
  onError,
  onOpenFleet,
}: {
  plans: Plan[]
  customers: Customer[]
  nowTick: number
  busy: boolean
  onBusy: (v: boolean) => void
  onStatus: (msg: string) => void
  onError: (msg: string | null) => void
  onOpenFleet?: () => void
}) {
  const [name, setName] = useState('30-day home')
  const [days, setDays] = useState('30')
  const [feeAmount, setFeeAmount] = useState('4000')
  const [editing, setEditing] = useState<Record<string, PlanDraft>>({})

  const mix = useMemo(() => {
    const total = Math.max(customers.length, 1)
    return [...plans]
      .sort((a, b) => a.days - b.days)
      .map((plan) => {
        const members = customers.filter((c) => c.planId === plan.id)
        const live = members.filter((c) => c.status === 'active' || c.status === 'grace')
        const dueSoon = members.filter((c) => {
          const left = daysLeft(c.paidUntilMs, nowTick)
          return left > 0 && left <= 3
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
  }, [plans, customers, nowTick])

  const kpis = useMemo(() => {
    const livePlans = mix.filter((row) => row.plan.active)
    return {
      packages: livePlans.length,
      subscribers: customers.length,
      booked: mix.reduce((sum, row) => sum + row.booked, 0),
      owed: mix.reduce((sum, row) => sum + row.owed, 0),
    }
  }, [mix, customers.length])

  const save = async (plan: Partial<Plan> & { name: string; days: number; feeAmount: number }) => {
    onBusy(true)
    onError(null)
    try {
      await savePlan({
        id: plan.id,
        name: plan.name,
        days: plan.days,
        feeAmount: plan.feeAmount,
        currency: 'GYD',
        active: plan.active ?? true,
      })
      onStatus(`Saved ${plan.name}.`)
      if (plan.id) {
        setEditing((prev) => {
          const next = { ...prev }
          delete next[plan.id as string]
          return next
        })
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save plan failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="tcd-plan-console">
      <section className="tcd-pulse-grid tcd-plan-kpis">
        <article className="tcd-pulse-card">
          <p className="tcd-pulse-eyebrow">Live packages</p>
          <p className="tcd-pulse-value">{kpis.packages}</p>
          <p className="tcd-pulse-meta">{plans.length} in catalog · GYD</p>
        </article>
        <article className="tcd-pulse-card">
          <p className="tcd-pulse-eyebrow">Subscribers on plans</p>
          <p className="tcd-pulse-value">{kpis.subscribers}</p>
          <p className="tcd-pulse-meta">Counted against the catalog below</p>
        </article>
        <article className="tcd-pulse-card">
          <p className="tcd-pulse-eyebrow">Booked cycle value</p>
          <p className="tcd-pulse-value tcd-pulse-currency">{formatGyd(kpis.booked)}</p>
          <p className="tcd-pulse-meta">Active + grace × current fee</p>
        </article>
        <article className="tcd-pulse-card">
          <p className="tcd-pulse-eyebrow">Still to collect</p>
          <p className={`tcd-pulse-value tcd-pulse-currency ${kpis.owed > 0 ? 'fail' : ''}`}>{formatGyd(kpis.owed)}</p>
          <p className="tcd-pulse-meta">Partial / grace balances</p>
        </article>
      </section>

      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>How the network is sold</h2>
          <span className="tcd-card-timestamp">occupancy by package</span>
        </div>
        {mix.length === 0 ? (
          <p className="tcd-empty-note">No packages yet. Seed defaults with auto-repair, or add a plan below.</p>
        ) : (
          <div className="tcd-mix">
            {mix.map((row) => (
              <div key={row.plan.id} className="tcd-mix-row">
                <div className="tcd-mix-label">
                  <strong>{row.plan.name}</strong>
                  <span className="muted small">
                    {row.members.length} customer{row.members.length === 1 ? '' : 's'} · {row.share}%
                  </span>
                </div>
                <div className="tcd-mix-track" aria-hidden="true">
                  <span className={`tcd-mix-fill ${row.plan.active ? '' : 'is-off'}`} style={{ width: `${Math.max(row.share, row.members.length ? 6 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tcd-plan-grid tcd-plan-grid-rich">
        {mix.map((row) => {
          const draft = editing[row.plan.id]
          const remainingBar = row.plan.days
            ? Math.min(
                100,
                Math.round(
                  (row.members.reduce((s, c) => s + Math.max(0, daysLeft(c.paidUntilMs, nowTick)), 0) /
                    Math.max(row.members.length * row.plan.days, 1)) *
                    100,
                ),
              )
            : 0
          return (
            <article key={row.plan.id} className={`tcd-plan-card tcd-plan-card-rich ${row.plan.active ? '' : 'is-hidden'}`}>
              <header className="tcd-plan-card-top">
                <p className="eyebrow">{row.plan.days}-day cycle</p>
                <span className={`pill ${row.plan.active ? 'tcd-ok' : 'tcd-warn'}`}>{row.plan.active ? 'Selling' : 'Hidden'}</span>
              </header>
              {draft ? (
                <div className="tcd-form-grid tcd-plan-edit">
                  <label>
                    Name
                    <input value={draft.name} onChange={(e) => setEditing((prev) => ({ ...prev, [row.plan.id]: { ...draft, name: e.target.value } }))} />
                  </label>
                  <label>
                    Days
                    <input value={draft.days} onChange={(e) => setEditing((prev) => ({ ...prev, [row.plan.id]: { ...draft, days: e.target.value } }))} />
                  </label>
                  <label>
                    Fee (GYD)
                    <input
                      value={draft.feeAmount}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [row.plan.id]: { ...draft, feeAmount: e.target.value } }))}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <h3>{row.plan.name}</h3>
                  <p className="tcd-plan-price">{formatGyd(row.plan.feeAmount)}</p>
                  <p className="muted small">G${row.daily.toLocaleString()} per day of service</p>
                </>
              )}
              <div className="tcd-plan-meter">
                <div className="tcd-plan-meter-head">
                  <span>{row.live} live</span>
                  <span>{remainingBar}% of granted days remaining</span>
                </div>
                <div className="tcd-mix-track">
                  <span className="tcd-mix-fill" style={{ width: `${remainingBar}%` }} />
                </div>
              </div>
              <ul className="tcd-plan-stats">
                <li>
                  <strong>{row.members.length}</strong>
                  <span>on this plan</span>
                </li>
                <li>
                  <strong>{row.dueSoon}</strong>
                  <span>due in 3 days</span>
                </li>
                <li>
                  <strong>{formatGyd(row.owed)}</strong>
                  <span>balance due</span>
                </li>
              </ul>
              <div className="tcd-plan-actions">
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
                      Save changes
                    </button>
                    <button className="btn btn-ghost-on-dark" type="button" onClick={() => setEditing((prev) => {
                      const next = { ...prev }
                      delete next[row.plan.id]
                      return next
                    })}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost-on-dark"
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
                  className="btn btn-ghost-on-dark"
                  type="button"
                  disabled={busy}
                  onClick={() => void save({ ...row.plan, active: !row.plan.active })}
                >
                  {row.plan.active ? 'Stop selling' : 'Start selling'}
                </button>
                {onOpenFleet && (
                  <button className="btn btn-ghost-on-dark" type="button" onClick={onOpenFleet}>
                    See subscribers
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>New package</h2>
          <span className="tcd-card-timestamp">creates a sellable ISP cycle</span>
        </div>
        <p className="muted small">
          New customers pick from packages that are selling. Changing a fee here updates the catalog; existing
          customer balances stay until the next extend.
        </p>
        <div className="tcd-form-grid" style={{ marginTop: '1rem' }}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="30-day home" />
          </label>
          <label>
            Cycle length (days)
            <input value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label>
            Fee (GYD)
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
      </div>
    </div>
  )
}
