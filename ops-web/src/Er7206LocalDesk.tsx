import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Customer } from './lib/types'
import * as repo from './lib/repo'

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
  userCount: number
  error?: string
}

type ReviewRow = {
  reason: string
  user: LocalUser
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
  const [connectorUrl, setConnectorUrl] = useState('')
  const [connectorToken, setConnectorToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const next = await repo.er7206LocalStatus()
      setStatus(next)
      setConnectorUrl(next.connectorUrl || '')
      if (next.connected) {
        const listed = await repo.er7206LocalListUsers()
        setUsers(listed.users ?? [])
        try {
          const dr = await repo.er7206LocalDryRun()
          setDryRun({
            review: (dr.review as ReviewRow[]) || [],
            unmatched_router: (dr.unmatched_router as DryRunSummary['unmatched_router']) || [],
            counts: dr.counts as Record<string, number> | undefined,
          })
        } catch {
          setDryRun(null)
        }
      } else {
        setUsers([])
        setDryRun(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      await repo.saveEr7206LocalConfig({ connectorUrl, connectorToken: connectorToken || undefined })
      setConnectorToken('')
      setMsg('Saved connector URL. Testing…')
      await refresh()
      setMsg('Saved.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const setEnable = async (user: LocalUser, enable: boolean) => {
    const label = enable
      ? `Unblock / enable router user “${user.userName}”? This toggles Luci enable=on (operator click only).`
      : `Block / disable router user “${user.userName}”? This toggles Luci enable=off (operator click only).`
    if (!window.confirm(label)) return
    setBusy(true)
    setErr(null)
    try {
      const result = await repo.er7206LocalSetUserEnable({
        userName: user.userName || '',
        key: user.key || user['.name'] || '',
        enable,
      })
      setMsg(result.ok ? `User ${user.userName} → enable=${enable ? 'on' : 'off'}` : result.error || 'failed')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
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

  const reviewRows: Array<{ kind: string; reason: string; user: LocalUser }> = [
    ...(dryRun?.review || []).map((r) => ({ kind: 'unsure', reason: r.reason, user: r.user })),
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
        <label>
          Connector base URL (VPS, e.g. https://ops…/er7206-connector or http://127.0.0.1:3141 via tunnel)
          <input value={connectorUrl} onChange={(e) => setConnectorUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label>
          Bearer token (optional; leave blank to keep saved)
          <input value={connectorToken} onChange={(e) => setConnectorToken(e.target.value)} type="password" autoComplete="off" />
        </label>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          Save &amp; test
        </button>
        <ul className="flag-list">
          <li>
            <span>Connected</span>
            <span className={`pill ${status?.connected ? 'ok' : 'fail'}`}>{status?.connected ? 'Yes' : 'No'}</span>
          </li>
          <li>
            <span>Mode</span>
            <span className="pill warn">{status?.mode || '—'}</span>
          </li>
          <li>
            <span>Router password on VPS</span>
            <span className={`pill ${status?.routerPassConfigured ? 'ok' : 'warn'}`}>
              {status?.routerPassConfigured ? 'Configured' : 'Missing'}
            </span>
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
                  <td className="tiny">{row.reason}</td>
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
              const blocked = u.enable === 'off'
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
                    <span className={`pill ${blocked ? 'fail' : 'ok'}`}>{u.enable || '—'}</span>
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
                      <button className="btn btn-tiny btn-primary" type="button" disabled={busy} onClick={() => void setEnable(u, true)}>
                        Unblock
                      </button>
                    ) : (
                      <button className="btn btn-tiny danger" type="button" disabled={busy} onClick={() => void setEnable(u, false)}>
                        Block
                      </button>
                    )}
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
