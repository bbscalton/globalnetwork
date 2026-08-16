import { useEffect, useState } from 'react'
import type { StaffInvite, StaffMember } from './types'
import { createStaffAccount, inviteStaff, listStaff, removeStaff, setStaffRole } from './repo'

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
  const [role, setRole] = useState<'staff' | 'admin'>('staff')

  const refresh = async () => {
    const next = await listStaff()
    setStaff(next.staff)
    setInvites(next.invites)
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : 'Could not load staff'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (work: () => Promise<string>) => {
    onBusy(true)
    onError(null)
    try {
      const msg = await work()
      await refresh()
      onStatus(msg)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Staff update failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="tcd-grid">
      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>Users &amp; roles</h2>
          <span className="tcd-card-timestamp">Admin only</span>
        </div>
        <p className="muted small">
          Invite a Google account, or create an email/password login. Invited staff get access on their next sign-in.
        </p>
        <div className="tcd-form-grid" style={{ marginTop: '1rem' }}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'staff')}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Password (only for new email login)
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
                return res.status === 'linked' ? `Linked existing account ${email}` : `Invited ${email}. They can sign in now.`
              })
            }
          >
            Invite email
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
                return `Created password login for ${email}`
              })
            }
          >
            Create password account
          </button>
        </div>
      </div>

      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>Active staff</h2>
        </div>
        <div className="tcd-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr key={row.uid}>
                  <td>{row.email}</td>
                  <td>{row.role}</td>
                  <td>{row.blocked ? 'Suspended' : 'Active'}</td>
                  <td>
                    <button
                      className="btn btn-ghost-on-dark"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await setStaffRole(row.uid, row.role === 'admin' ? 'staff' : 'admin', row.blocked)
                        return `Updated role for ${row.email}`
                      })}
                    >
                      Make {row.role === 'admin' ? 'staff' : 'admin'}
                    </button>{' '}
                    <button
                      className="btn btn-ghost-on-dark"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await setStaffRole(row.uid, row.role === 'admin' ? 'admin' : 'staff', !row.blocked)
                        return `${row.blocked ? 'Restored' : 'Suspended'} ${row.email}`
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
              {staff.length === 0 && (
                <tr>
                  <td colSpan={4}>No staff profiles yet. Invite someone above.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {invites.length > 0 && (
        <div className="tcd-card tcd-card-wide">
          <div className="tcd-card-head">
            <h2>Pending invites</h2>
          </div>
          <ul className="tcd-repair-log">
            {invites.map((row) => (
              <li key={row.email}>
                {row.email} · {row.role} · invited by {row.invitedBy}{' '}
                <button
                  className="btn btn-ghost-on-dark"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await removeStaff(undefined, row.email)
                    return `Canceled invite for ${row.email}`
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
