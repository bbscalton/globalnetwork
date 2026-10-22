import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Customer } from './lib/types'
import * as repo from './lib/repo'
import { runRouterCommand, useRouterLocks } from './lib/routerLock'

type LocalUser = {
  userName?: string
  enable?: string
  expireTime?: string
  macBindAddr?: string
  noteNote?: string
  noteName?: string
  userType?: string
  key?: string
  '.name'?: string
}

type LocalStatus = {
  ok: boolean
  connected: boolean
  connectorUrl: string
  mode: string
  routerPassConfigured: boolean
  routerLoginOk?: boolean
  lastSyncMs?: number
  userCount: number
  error?: string
}

type ReviewRow = {
  reason: string
  user: LocalUser
  strength?: string
  routerExpiry?: string
  routerPlan?: string | null
  suggestedCustomer?: { id: string; name?: string; planName?: string; status?: string }
  candidates?: Array<{ id: string; name?: string }>
}

type DryRunSummary = {
  review: ReviewRow[]
  unmatched_router: Array<{ reason: string; user: LocalUser }>
  counts?: Record<string, number>
}

export function Er7206LocalDesk({ customers }: { customers: Customer[] }) {
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [users, setUsers] = useState<LocalUser[]>([])
  const [dryRun, setDryRun] = useState<DryRunSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState<string | null>(null)
  const locks = useRouterLocks()

  const refresh = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const docs = await repo.er7206LocalConnectorDocs()
      const s = docs.status || {}
      const lastSyncMs = Number(s.lastSyncMs || 0)
      const fresh = lastSyncMs > 0 && Date.now() - lastSyncMs < 15 * 60 * 1000
      setStatus({
        ok: true,
        connected: !!s.connectorOnline && fresh,
        connectorUrl: String(s.host || ''),
        mode: String(s.mode || (docs.status ? 'unknown' : 'no status yet')),
        routerPassConfigured: !!s.routerPassConfigured && !!s.routerUserConfigured,
        routerLoginOk: !!s.routerLoginOk,
        lastSyncMs,
        userCount: Number(s.userCount || 0),
        error: s.routerError ? String(s.routerError) : !fresh && docs.status ? 'Last VPS sync is older than 15 minutes' : undefined,
      })
      const r = docs.review || {}
      setDryRun({
        review: (r.review as ReviewRow[]) || [],
        unmatched_router: (r.unmatched_router as DryRunSummary['unmatched_router']) || [],
        counts: r.counts as Record<string, number> | undefined,
      })
      // Router users come from the VPS sync (passwords stripped on the VPS); no direct connector call.
      const pick = (arr: unknown) => (Array.isArray(arr) ? (arr as Array<{ user?: LocalUser }>).map((x) => x.user).filter(Boolean) : []) as LocalUser[]
      setUsers([...pick(r.matched), ...pick(r.review), ...pick(r.unmatched_router)])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setEnable = async (user: LocalUser, enable: boolean) => {
    const label = enable
      ? `Unblock / enable router user “${user.userName}”? Queues a router job: resets its GN-Blocked slot and sets enable=on (~30s).`
      : `Block / disable router user “${user.userName}”? Queues a router job: GN-Blocked slot, or enable=off if offline (~30s).`
    if (!window.confirm(label)) return
    const lockKey = `er7206-enable:${user.userName || user.key || user['.name']}`
    setErr(null)
    try {
      await runRouterCommand(
        lockKey,
        async () => {
          const result = await repo.er7206LocalSetUserEnable({
            userName: user.userName || '',
            key: user.key || user['.name'] || '',
            enable,
          })
          if (!result.ok) throw new Error(result.error || 'failed')
          setMsg(`${enable ? 'Unblock' : 'Block'} queued for ${user.userName} (job ${result.routerJobId}); router updates within ~30s`)
          return result.routerJobId
        },
        { optimistic: enable ? 'on' : 'off', onDone: () => void refresh() },
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const linkCustomer = async (user: LocalUser, customerId: string) => {
    if (!customerId || !user.userName) return
    const who = customers.find((c) => c.id === customerId)
    if (!window.confirm(`Link router user “${user.userName}” to customer “${who?.name || customerId}”? This only stores the link fields — it does not create a customer.`)) return
    setLinkBusy(user.userName)
    setErr(null)
    try {
      await repo.er7206LocalLinkCustomer({
        customerId,
        userName: user.userName,
        mac: user.macBindAddr || '',
      })
      setMsg(`Linked ${user.userName} → ${who?.name || customerId}`)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLinkBusy(null)
    }
  }

  const reviewRows: Array<{ kind: string; reason: string; user: LocalUser; row?: ReviewRow }> = [
    ...(dryRun?.review || []).map((r) => ({ kind: 'unsure', reason: r.reason, user: r.user, row: r })),
    ...(dryRun?.unmatched_router || []).map((r) => ({ kind: 'no_customer', reason: r.reason || 'no_match', user: r.user })),
  ]

  return (
    <div className="desk">
      <header className="desk-head">
        <div>
          <h1>ER7206 · local users</h1>
          <p className="muted">
            Read-only sync from the VPS connector (<code>/opt/gn-er7206-connector</code>) over WireGuard to the
            router&apos;s Luci User Manager. Beside Omada Open API / Legacy Omada ER7206.
          </p>
        </div>
        <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <section className="card">
        <h2>Connector</h2>
        <p className="muted tiny">
          Status is published every 5 minutes by the VPS connector ({status?.connectorUrl || 'VPS'}). Router credentials stay on the VPS;
          only “configured yes/no” is shown here.
        </p>
        <ul className="flag-list">
          <li>
            <span>VPS connector online</span>
            <span className={`pill ${status?.connected ? 'ok' : 'fail'}`}>{status?.connected ? 'Yes' : 'No'}</span>
          </li>
          <li>
            <span>Mode</span>
            <span className="pill warn">{status?.mode || '—'}</span>
          </li>
          <li>
            <span>Router credentials on VPS</span>
            <span className={`pill ${status?.routerPassConfigured ? 'ok' : 'warn'}`}>
              {status?.routerPassConfigured ? 'Configured' : 'Missing'}
            </span>
          </li>
          <li>
            <span>Router login (last sync)</span>
            <span className={`pill ${status?.routerLoginOk ? 'ok' : 'fail'}`}>{status?.routerLoginOk ? 'OK' : 'Failed'}</span>
          </li>
          <li>
            <span>Last sync</span>
            <span className="pill">{status?.lastSyncMs ? new Date(status.lastSyncMs).toLocaleString() : '—'}</span>
          </li>
          <li>
            <span>Users</span>
            <span className="pill">{status?.userCount ?? '—'}</span>
          </li>
        </ul>
        {status?.error && <p className="fail">{status.error}</p>}
      </section>

      <section className="card" id="router-review">
        <h2>Router review</h2>
        <p className="muted tiny">
          Unsure matches and router users with no customer. Use <strong>Link to customer</strong> only — never creates
          customers. Confident auto-matches are applied by the VPS dry-run/sync; these stay here until linked.
          {dryRun?.counts ? (
            <>
              {' '}
              Counts: review {dryRun.counts.review ?? 0}, unmatched {dryRun.counts.unmatched_router ?? 0}.
            </>
          ) : null}
        </p>
        <table className="roster">
          <thead>
            <tr>
              <th>Router user</th>
              <th>Why here</th>
              <th>Suggested customer</th>
              <th>Router expiry / plan</th>
              <th>MAC / note</th>
              <th>Link to customer</th>
            </tr>
          </thead>
          <tbody>
            {reviewRows.map((row) => {
              const key = row.user.userName || row.user['.name'] || Math.random().toString(36)
              return (
                <tr key={`${row.kind}-${key}`}>
                  <td>
                    <strong>{row.user.userName || '—'}</strong>
                    <div className="muted tiny">{row.kind === 'no_customer' ? 'No customer' : 'Unsure match'}</div>
                  </td>
                  <td className="tiny">
                    {row.reason}
                    {row.row?.strength === 'weak' ? <span className="pill warn"> weak</span> : null}
                  </td>
                  <td className="tiny">{row.row?.suggestedCustomer?.name || '—'}</td>
                  <td className="tiny">
                    {row.row?.routerExpiry || row.user.expireTime || '—'}
                    <br />
                    {row.row?.routerPlan || ''}
                  </td>
                  <td className="tiny">
                    {row.user.macBindAddr || '—'}
                    <br />
                    {row.user.noteNote || row.user.noteName || ''}
                  </td>
                  <td>
                    <select
                      defaultValue=""
                      disabled={!!linkBusy || busy}
                      onChange={(e) => {
                        const id = e.target.value
                        e.target.value = ''
                        if (id) void linkCustomer(row.user, id)
                      }}
                    >
                      <option value="">Link to customer…</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.email || c.id}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {reviewRows.length === 0 && (
          <p className="empty">No review items. Connect the VPS connector and run a dry-run to populate this list.</p>
        )}
      </section>

      <section className="card">
        <h2>Local users</h2>
        <p className="muted tiny">
          Block/unblock toggles Luci <code>enable</code> on/off when an operator clicks — never from expiry sweep until
          writes are approved on the connector (<code>ENABLE_WRITES=1</code>).
        </p>
        <table className="roster">
          <thead>
            <tr>
              <th>User</th>
              <th>MAC / note</th>
              <th>Expiry</th>
              <th>Enable</th>
              <th>Customer hint</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const mac = (u.macBindAddr || '').toLowerCase()
              const hint = customers.find(
                (c) =>
                  (c.cpeMac || c.omadaClientMac || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase() ===
                  mac.replace(/[^a-fA-F0-9]/g, ''),
              )
              const lockKey = `er7206-enable:${u.userName || u.key || u['.name']}`
              const shownEnable = locks.optimistic<string>(lockKey) ?? u.enable
              const blocked = shownEnable === 'off'
              const pending = locks.locked(lockKey)
              const note = locks.note(lockKey)
              return (
                <tr key={u.userName || u['.name']}>
                  <td>
                    <strong>{u.userName}</strong>
                    <div className="muted tiny">{u.userType}</div>
                  </td>
                  <td className="tiny">
                    {u.macBindAddr || '—'}
                    <br />
                    {u.noteNote || u.noteName || ''}
                  </td>
                  <td className="tiny">{u.expireTime || '—'}</td>
                  <td>
                    <span className={`pill ${pending ? 'warn' : blocked ? 'fail' : 'ok'}`}>{shownEnable || '—'}{pending ? ' · applying' : ''}</span>
                  </td>
                  <td>
                    {hint ? (
                      <Link className="tiny" to={`/c/${hint.id}`}>
                        {hint.name || hint.id}
                      </Link>
                    ) : (
                      <span className="muted tiny">—</span>
                    )}
                  </td>
                  <td className="roster-actions">
                    {blocked ? (
                      <button className="btn btn-tiny btn-primary" type="button" disabled={busy || pending} aria-busy={pending} onClick={() => void setEnable(u, true)}>
                        {locks.lockText(lockKey, 'Unblock')}
                      </button>
                    ) : (
                      <button className="btn btn-tiny danger" type="button" disabled={busy || pending} aria-busy={pending} onClick={() => void setEnable(u, false)}>
                        {locks.lockText(lockKey, 'Block')}
                      </button>
                    )}
                    {note && <div className="tiny warn-text">{note}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {users.length === 0 && <p className="empty">No users loaded. Configure the VPS connector and router password.</p>}
      </section>

      {msg && <p className="ok-text">{msg}</p>}
      {err && <p className="fail">{err}</p>}
    </div>
  )
}
