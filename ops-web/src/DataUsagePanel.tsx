import { useEffect, useState } from 'react'
import type { Customer } from './lib/types'
import { GB, fmtBytes, monthUsed, observeUsage, setDataLimit, setRouterSpeed, type CustomerUsage, type DataLimitAction } from './lib/usage'
import { fmtWhen } from './lib/desk'
import { runRouterCommand, useRouterLocks } from './lib/routerLock'

/**
 * Data section on the customer page. Usage comes from the ER7206 IP Statistics (read-only sync).
 * Speed controls use the router's per-user Upstream/Downstream Bandwidth fields (local user object;
 * 0 = no limit), verified on a throwaway user. Shown only for customers linked to a router user.
 */
export function DataUsagePanel({ customer, isOwner }: { customer: Customer; isOwner: boolean }) {
  const [usage, setUsage] = useState<CustomerUsage | null>(null)
  const [limit, setLimit] = useState(String(customer.dataLimitGb ?? ''))
  const [action, setAction] = useState<DataLimitAction>(customer.dataLimitAction ?? 'alert')
  const [up, setUp] = useState(String(customer.dataThrottleUpKbps ?? 512))
  const [down, setDown] = useState(String(customer.dataThrottleDownKbps ?? 1024))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const locks = useRouterLocks()
  // Same per-customer lock as the customer page router buttons (see lib/routerLock).
  const routerKey = `customer-router:${customer.id}`
  const locked = locks.locked(routerKey)
  const pendingAction = locks.optimistic<string>(routerKey)
  const label = (action: string, idle: string) => (locked && pendingAction === action ? locks.lockText(routerKey, idle) : idle)
  const runRouter = (action: string, fn: () => Promise<{ msg: string; jobId?: string | null }>) => {
    if (locked) return
    void run(async () => {
      let out = ''
      await runRouterCommand(routerKey, async () => {
        const r = await fn()
        out = r.msg
        return r.jobId ?? null
      }, { optimistic: action })
      return out
    })
  }

  useEffect(() => observeUsage(customer.id, setUsage), [customer.id])
  useEffect(() => {
    setLimit(String(customer.dataLimitGb ?? ''))
    setAction(customer.dataLimitAction ?? 'alert')
  }, [customer.dataLimitGb, customer.dataLimitAction])

  const used = monthUsed(usage ?? undefined)
  const limitBytes = (customer.dataLimitGb ?? 0) > 0 ? (customer.dataLimitGb as number) * GB : 0
  const pct = limitBytes ? Math.min(100, Math.round((used.total / limitBytes) * 100)) : 0
  const over = limitBytes > 0 && used.total >= limitBytes
  const throttled = pendingAction === 'throttle' ? true : pendingAction === 'restore' ? false : customer.er7206Speed?.throttled === true

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg('')
    try { setMsg(await fn()) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (!customer.er7206UserName) {
    return <div className="muted tiny">Data usage appears once this customer is linked to an ER7206 router user.</div>
  }

  return (
    <div className="data-usage">
      <h3 style={{ margin: '0 0 0.4rem' }}>Data this month</h3>
      {usage ? (
        <>
          <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>
            {fmtBytes(used.total)}{limitBytes ? <span className="muted"> / {customer.dataLimitGb} GB</span> : <span className="muted tiny"> · no limit</span>}
            {over && <span className="pill fail" style={{ marginLeft: 8 }}>over limit</span>}
            {throttled && <span className="pill warn" style={{ marginLeft: 8 }}>speed reduced</span>}
          </div>
          {limitBytes > 0 && (
            <div className="cycle-track glow-bar" aria-hidden="true" style={{ margin: '0.4rem 0' }}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="muted tiny">
            ↓ {fmtBytes(used.down)} · ↑ {fmtBytes(used.up)} · IP {usage.ip || 'offline'} · updated {fmtWhen(usage.updatedAtMs ?? 0)}
            {usage.trackingSinceMs ? ` · tracking since ${fmtWhen(usage.trackingSinceMs)}` : ''}
          </div>
        </>
      ) : (
        <div className="muted tiny">No usage reported yet (router sync runs every 5 min).</div>
      )}

      {isOwner && (
        <>
          <form className="form-row" style={{ marginTop: '0.6rem' }} onSubmit={(e) => {
            e.preventDefault()
            runRouter('limit', async () => {
              const n = Number(limit)
              await setDataLimit(customer.id, {
                dataLimitGb: Number.isFinite(n) && n > 0 ? n : null,
                dataLimitAction: action,
                dataThrottleUpKbps: Math.max(10, Number(up) || 512),
                dataThrottleDownKbps: Math.max(10, Number(down) || 1024),
              })
              return { msg: 'Data limit saved' }
            })
          }}>
            <label>Monthly limit (GB)<input inputMode="decimal" value={limit} placeholder="none" onChange={(e) => setLimit(e.target.value)} /></label>
            <label>At the limit
              <select value={action} onChange={(e) => setAction(e.target.value as DataLimitAction)}>
                <option value="alert">Show on desk only</option>
                <option value="throttle">Drop speed</option>
                <option value="cap">Cut off (router block)</option>
              </select>
            </label>
            <label>Reduced up (Kbps)<input inputMode="numeric" value={up} onChange={(e) => setUp(e.target.value)} /></label>
            <label>Reduced down (Kbps)<input inputMode="numeric" value={down} onChange={(e) => setDown(e.target.value)} /></label>
            <button className="btn btn-ghost" type="submit" disabled={busy || locked}>{label('limit', 'Save limit')}</button>
          </form>
          <span className="form-row">
            <button className="btn btn-ghost warn" type="button" disabled={busy || locked} onClick={() => runRouter('throttle', async () => {
              const r = await setRouterSpeed({ customerId: customer.id, action: 'throttle', upBand: Number(up), downBand: Number(down) })
              return { msg: `Speed drop queued (${r.routerJobId}); router applies it within ~30s`, jobId: r.routerJobId }
            })}>{label('throttle', 'Drop speed now')}</button>
            <button className="btn btn-ghost" type="button" disabled={busy || locked} onClick={() => runRouter('restore', async () => {
              const r = await setRouterSpeed({ customerId: customer.id, action: 'restore' })
              return { msg: `Full speed restore queued (${r.routerJobId})`, jobId: r.routerJobId }
            })}>{label('restore', 'Restore full speed')}</button>
          </span>
          <div className="muted tiny">
            Speed uses the router user's own Upstream/Downstream Bandwidth fields (0 = unlimited). Cut off uses the existing router block.
            Automatic action at the limit runs only when the connector's USAGE_ENFORCE switch is on.
          </div>
        </>
      )}
      {locks.note(routerKey) && <p className="tiny warn-text">{locks.note(routerKey)}</p>}
      {msg && <p className="muted tiny">{msg}</p>}
    </div>
  )
}
