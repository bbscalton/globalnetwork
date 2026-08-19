import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fmtWhen } from './lib/desk'
import { rollupCollections } from './lib/collections'
import * as repo from './lib/repo'
import type { Payment, PosOutlet } from './lib/types'
import { useAuth } from './lib/authContext'

export function OutletsDesk() {
  const { canOutlets } = useAuth()
  const [outlets, setOutlets] = useState<PosOutlet[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [now, setNow] = useState(Date.now())
  const [name, setName] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [rename, setRename] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    void repo.seedDefaultPosOutlets().catch(() => undefined)
    const u1 = repo.observePosOutlets(setOutlets, (e) => setErr(e.message))
    const u2 = repo.observeCollectionPayments(setPayments, (e) => setErr(e.message))
    return () => {
      u1()
      u2()
    }
  }, [])

  const stats = useMemo(() => rollupCollections(payments, outlets, now), [payments, outlets, now])

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

  const add = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await repo.savePosOutlet({ name })
      setName('')
      return 'Outlet added. Field POS will offer it at session start.'
    })
  }

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Collections</p>
          <h1>Outlets</h1>
          <p className="muted">
            Antigua collection sites and paid-in cash (EC$ / XCD). Totals are actual collections, not unpaid
            day-extension charges.
          </p>
        </div>
      </header>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      <div className="kpi-strip">
        <article className="kpi-card">
          <p className="eyebrow">Today</p>
          <strong>{repo.formatEc(stats.today)}</strong>
          <span className="muted tiny">Antigua calendar day</span>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">This month</p>
          <strong>{repo.formatEc(stats.month)}</strong>
          <span className="muted tiny">America/Antigua</span>
        </article>
        <article className="kpi-card kpi-glow">
          <p className="eyebrow">All time paid in</p>
          <strong>{repo.formatEc(stats.all)}</strong>
          <span className="muted tiny">
            {stats.count} payment{stats.count === 1 ? '' : 's'}
          </span>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">Last collection</p>
          <strong>{stats.last ? repo.formatEc(stats.last.amount) : '—'}</strong>
          <span className="muted tiny">
            {stats.last
              ? `${stats.last.locationName || 'Owner desk'} · ${fmtWhen(stats.last.atMs)}`
              : 'No cash collections yet'}
          </span>
        </article>
      </div>

      <section className="card table-card">
        <div className="card-head" style={{ padding: '1rem 1.1rem 0' }}>
          <h2>Paid in by outlet</h2>
        </div>
        <table className="roster">
          <thead>
            <tr>
              <th>Outlet</th>
              <th>Today</th>
              <th>Month</th>
              <th>All time</th>
              <th>Payments</th>
              <th>Last</th>
              {canOutlets && <th></th>}
            </tr>
          </thead>
          <tbody>
            {stats.byOutlet.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  {row.disabled && <span className="pill warn">Disabled</span>}
                  {row.id === 'owner-desk' && <div className="muted tiny">Desk collect without a field site</div>}
                </td>
                <td>{repo.formatEc(row.today)}</td>
                <td>{repo.formatEc(row.month)}</td>
                <td>{repo.formatEc(row.all)}</td>
                <td>{row.count}</td>
                <td className="muted tiny">
                  {row.lastAtMs ? `${repo.formatEc(row.lastAmount)} · ${fmtWhen(row.lastAtMs)}` : '—'}
                </td>
                {canOutlets && (
                  <td className="roster-actions">
                    {row.id !== 'owner-desk' && outlets.some((o) => o.id === row.id) && (
                      <>
                        {renameId === row.id ? (
                          <form
                            className="rename-inline"
                            onSubmit={(e) => {
                              e.preventDefault()
                              void run(async () => {
                                const current = outlets.find((o) => o.id === row.id)
                                await repo.savePosOutlet({
                                  id: row.id,
                                  name: rename,
                                  disabled: current?.disabled,
                                })
                                setRenameId(null)
                                return 'Outlet renamed.'
                              })
                            }}
                          >
                            <input value={rename} onChange={(e) => setRename(e.target.value)} />
                            <button className="btn btn-tiny btn-primary" type="submit" disabled={busy}>
                              Save
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              className="btn btn-tiny btn-ghost"
                              type="button"
                              onClick={() => {
                                setRenameId(row.id)
                                setRename(row.name)
                              }}
                            >
                              Rename
                            </button>
                            <button
                              className="btn btn-tiny btn-ghost"
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await repo.savePosOutlet({
                                    id: row.id,
                                    name: row.name,
                                    disabled: !row.disabled,
                                  })
                                  return row.disabled ? 'Outlet enabled for POS.' : 'Outlet hidden from POS.'
                                })
                              }
                            >
                              {row.disabled ? 'Enable' : 'Disable'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canOutlets && (
        <form className="card" onSubmit={add}>
          <div className="card-head">
            <h2>Add collection site</h2>
          </div>
          <p className="muted">Cashiers pick from this list on field POS. Disabled sites stay in accounting history.</p>
          <div className="form-row">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Liberta" required />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'end' }}>
              Add outlet
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
