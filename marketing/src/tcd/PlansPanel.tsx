import { useState } from 'react'
import type { Plan } from './types'
import { formatGyd, savePlan } from './repo'

export function PlansPanel({
  plans,
  busy,
  onBusy,
  onStatus,
  onError,
}: {
  plans: Plan[]
  busy: boolean
  onBusy: (v: boolean) => void
  onStatus: (msg: string) => void
  onError: (msg: string | null) => void
}) {
  const [name, setName] = useState('30-day home')
  const [days, setDays] = useState('30')
  const [feeAmount, setFeeAmount] = useState('4000')

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
      onStatus(`Saved plan ${plan.name}.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save plan failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="tcd-card tcd-card-wide">
      <div className="tcd-card-head">
        <h2>Plans</h2>
        <span className="tcd-card-timestamp">GYD packages</span>
      </div>
      <div className="tcd-plan-grid">
        {plans.map((p) => (
          <article key={p.id} className="tcd-plan-card">
            <p className="eyebrow">{p.days} days</p>
            <h3>{p.name}</h3>
            <p style={{ fontSize: '1.8rem', margin: '0.4rem 0' }}>{formatGyd(p.feeAmount)}</p>
            <p className="muted small">{p.active ? 'Active' : 'Hidden'}</p>
            <button
              className="btn btn-ghost-on-dark"
              type="button"
              disabled={busy}
              onClick={() => void save({ ...p, active: !p.active })}
              style={{ marginTop: '0.8rem' }}
            >
              {p.active ? 'Disable' : 'Enable'}
            </button>
          </article>
        ))}
        {plans.length === 0 && <p className="muted">Run auto-repair to seed 15 / 30 / 90 day defaults.</p>}
      </div>
      <h3 style={{ marginTop: '1.5rem' }}>Add plan</h3>
      <div className="tcd-form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Days
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
        disabled={busy}
        style={{ marginTop: '1rem' }}
        onClick={() => void save({ name, days: Number(days), feeAmount: Number(feeAmount), active: true })}
      >
        Save plan
      </button>
    </div>
  )
}
