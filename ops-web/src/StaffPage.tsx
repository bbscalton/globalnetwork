import { useEffect, useState } from 'react'
import type { StaffInvite, StaffMember } from './lib/types'
import { createStaffAccount, inviteStaff, listStaff, removeStaff, setStaffRole } from './lib/repo'

export function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'staff' | 'admin'>('staff')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const next = await listStaff()
    setStaff(next.staff)
    setInvites(next.invites)
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Could not load staff'))
  }, [])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      setMsg(await work())
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Staff update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Staff &amp; roles</h1>
      <p className="muted">Invite Google accounts or create an email/password login. Only neuereatec@gmail.com can manage this list.</p>
      {error && <p className="fail">{error}</p>}
      {msg && <p className="muted">{msg}</p>}
      <div className="card" style={{ marginTop: 16, display: 'grid', gap: 8, maxWidth: 520 }}>
        <input type="email" placeholder="staff@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'staff')}>
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
        <input type="password" minLength={6} placeholder="Password if creating a login" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || !email.trim()}
            onClick={() =>
              void run(async () => {
                const res = await inviteStaff(email.trim(), role)
                setEmail('')
                return res.status === 'linked' ? 'Linked existing Firebase account' : 'Invite saved — they can sign in now'
              })
            }
          >
            Invite
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || !email.trim() || password.length < 6}
            onClick={() =>
              void run(async () => {
                await createStaffAccount(email.trim(), password, role)
                setEmail('')
                setPassword('')
                return 'Password account created'
              })
            }
          >
            Create password account
          </button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        {staff.map((row) => (
          <p key={row.uid} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>{row.email}</strong> · {row.role} · {row.blocked ? 'suspended' : 'active'}
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(async () => {
              await setStaffRole(row.uid, row.role === 'admin' ? 'staff' : 'admin', row.blocked)
              return 'Role updated'
            })}>
              Toggle role
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(async () => {
              await setStaffRole(row.uid, row.role === 'admin' ? 'admin' : 'staff', !row.blocked)
              return row.blocked ? 'Restored' : 'Suspended'
            })}>
              {row.blocked ? 'Restore' : 'Suspend'}
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(async () => {
              await removeStaff(row.uid, row.email)
              return 'Removed'
            })}>
              Remove
            </button>
          </p>
        ))}
        {staff.length === 0 && <p className="muted">No staff yet.</p>}
      </div>
      {invites.map((row) => (
        <p key={row.email} className="muted">
          Pending: {row.email} ({row.role}){' '}
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(async () => {
            await removeStaff(undefined, row.email)
            return 'Invite canceled'
          })}>
            Cancel
          </button>
        </p>
      ))}
    </>
  )
}
