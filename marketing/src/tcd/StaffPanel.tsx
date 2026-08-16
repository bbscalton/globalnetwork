import { useEffect, useMemo, useState } from 'react'
import type { StaffInvite, StaffMember } from './types'
import { createStaffAccount, inviteStaff, listStaff, removeStaff, setStaffRole } from './repo'
import { parseRole, roleLabel, type StaffRole } from './roles'

const ASSIGNABLE: Array<Exclude<StaffRole, 'pending'>> = ['desk', 'support', 'admin']

export function StaffPanel({
  busy,
  onBusy,
  onStatus,
  onError,
}: {
  busy: boolean
  onBusy: (v: boolean) => void
  onStatus: (msg: string) => void
  onError: (msg: string | null) => void
}) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Exclude<StaffRole, 'pending'>>('desk')

  const refresh = async () => {
    const next = await listStaff()
    setStaff(next.staff)
    setInvites(next.invites)
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : 'Could not load users'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const waiting = useMemo(() => staff.filter((row) => parseRole(row.role) === 'pending' && !row.blocked), [staff])
  const active = useMemo(() => staff.filter((row) => parseRole(row.role) !== 'pending'), [staff])

  const run = async (work: () => Promise<string>) => {
    onBusy(true)
    onError(null)
    try {
      const msg = await work()
      await refresh()
      onStatus(msg)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'User update failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="tcd-grid">
      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>Google sign-in &amp; roles</h2>
          <span className="tcd-card-timestamp">Control plane only</span>
        </div>
        <p className="muted small">
          Anyone who signs in with Google appears here as <strong>Awaiting role</strong>. Assign Customer desk,
          Support, or Control admin. Pre-invite an email if they have not signed in yet.
        </p>
        <div className="tcd-form-grid" style={{ marginTop: '1rem' }}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tech@example.com" />
          </label>
          <label>
            Role to grant
            <select value={role} onChange={(e) => setRole(e.target.value as Exclude<StaffRole, 'pending'>)}>
              <option value="desk">Customer desk — subscribers, renewals, collections</option>
              <option value="support">Support — chat and tickets only</option>
              <option value="admin">Control admin — TCD plans, health, and users</option>
            </select>
          </label>
          <label>
            Password (only if creating a non-Google login)
            <input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Optional" />
          </label>
        </div>
        <div className="tcd-hero-actions" style={{ marginTop: '1rem' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || !email.trim()}
            onClick={() =>
              void run(async () => {
                const res = await inviteStaff(email.trim(), role)
                setEmail('')
                return res.status === 'linked'
                  ? `Assigned ${roleLabel(role)} to ${email}`
                  : `Reserved ${email} as ${roleLabel(role)}. They get it on Google sign-in.`
              })
            }
          >
            Reserve email + role
          </button>
          <button
            className="btn btn-ghost-on-dark"
            type="button"
            disabled={busy || !email.trim() || password.length < 6}
            onClick={() =>
              void run(async () => {
                await createStaffAccount(email.trim(), password, role)
                setEmail('')
                setPassword('')
                return `Created password login for ${email} as ${roleLabel(role)}`
              })
            }
          >
            Create password account
          </button>
        </div>
      </div>

      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>Awaiting a role</h2>
          <span className="tcd-card-timestamp">{waiting.length} Google sign-ins</span>
        </div>
        {waiting.length === 0 && (
          <p className="tcd-empty-note">No pending Google users. Have them open TCD or the customer desk and sign in with Google.</p>
        )}
        <div className="tcd-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Signed in</th>
                <th>Assign</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((row) => (
                <tr key={row.uid}>
                  <td>
                    <strong>{row.displayName || row.email}</strong>
                    <div className="muted small">{row.email} · {row.provider || 'google'}</div>
                  </td>
                  <td>{row.lastLoginMs ? new Date(row.lastLoginMs).toLocaleString() : '—'}</td>
                  <td>
                    <div className="tcd-plan-actions">
                      {ASSIGNABLE.map((next) => (
                        <button
                          key={next}
                          className="btn btn-ghost-on-dark"
                          type="button"
                          disabled={busy}
                          onClick={() => void run(async () => {
                            await setStaffRole(row.uid, next, false)
                            return `${row.email} is now ${roleLabel(next)}`
                          })}
                        >
                          {roleLabel(next)}
                        </button>
                      ))}
                      <button className="btn btn-ghost-on-dark" type="button" disabled={busy} onClick={() => void run(async () => {
                        await removeStaff(row.uid, row.email)
                        return `Removed ${row.email}`
                      })}>
                        Ignore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>Assigned users</h2>
        </div>
        <div className="tcd-table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((row) => (
                <tr key={row.uid}>
                  <td>
                    <strong>{row.displayName || row.email}</strong>
                    <div className="muted small">{row.email}</div>
                  </td>
                  <td>
                    <select
                      value={parseRole(row.role) === 'pending' ? 'desk' : parseRole(row.role)}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value as Exclude<StaffRole, 'pending'>
                        void run(async () => {
                          await setStaffRole(row.uid, next, row.blocked)
                          return `${row.email} → ${roleLabel(next)}`
                        })
                      }}
                    >
                      {ASSIGNABLE.map((next) => (
                        <option key={next} value={next}>
                          {roleLabel(next)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{row.blocked ? 'Suspended' : 'Active'}</td>
                  <td>
                    <button
                      className="btn btn-ghost-on-dark"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await setStaffRole(row.uid, parseRole(row.role) === 'pending' ? 'desk' : (parseRole(row.role) as Exclude<StaffRole, 'pending'>), !row.blocked)
                        return row.blocked ? `Restored ${row.email}` : `Suspended ${row.email}`
                      })}
                    >
                      {row.blocked ? 'Restore' : 'Suspend'}
                    </button>{' '}
                    <button
                      className="btn btn-ghost-on-dark"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await removeStaff(row.uid, row.email)
                        return `Removed ${row.email}`
                      })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {active.length === 0 && (
                <tr>
                  <td colSpan={4}>No assigned operators yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {invites.length > 0 && (
        <div className="tcd-card tcd-card-wide">
          <div className="tcd-card-head">
            <h2>Reserved emails</h2>
          </div>
          <ul className="tcd-repair-log">
            {invites.map((row) => (
              <li key={row.email}>
                {row.email} will become {roleLabel(String(row.role))} on first Google sign-in · reserved by {row.invitedBy}{' '}
                <button
                  className="btn btn-ghost-on-dark"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await removeStaff(undefined, row.email)
                    return `Canceled ${row.email}`
                  })}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
