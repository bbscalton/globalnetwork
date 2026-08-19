import { useEffect, useState, type FormEvent } from 'react'
import * as repo from './lib/repo'
import { fmtWhen } from './lib/desk'
import { useAuth } from './lib/authContext'
import type { DeskInvite, DeskMember, DeskRole, PosOutlet } from './lib/types'

type StaffRole = 'owner' | 'manager' | 'cashier'

function roleLabel(role: DeskRole | string): string {
  if (role === 'manager') return 'Manager'
  if (role === 'cashier') return 'Cashier'
  if (role === 'owner') return 'Owner'
  return role
}

export function AccountsDesk({ embedded = false }: { embedded?: boolean }) {
  const { user, member } = useAuth()
  const [members, setMembers] = useState<DeskMember[]>([])
  const [invites, setInvites] = useState<DeskInvite[]>([])
  const [outlets, setOutlets] = useState<PosOutlet[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<StaffRole>('cashier')
  const [outletIds, setOutletIds] = useState<string[]>([])
  const [rejectFor, setRejectFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [approveRole, setApproveRole] = useState<StaffRole>('cashier')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const u1 = repo.observeDeskMembers(setMembers)
    const u2 = repo.observeDeskInvites(setInvites)
    const u3 = repo.observePosOutlets(setOutlets)
    return () => {
      u1()
      u2()
      u3()
    }
  }, [])

  const staff = members.filter((m) => m.role === 'owner' || m.role === 'manager' || m.role === 'cashier')
  const pending = members.filter((m) => m.role === 'pending')
  const rejected = members.filter((m) => m.role === 'rejected')
  const activeOutlets = outlets.filter((o) => !o.disabled)

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

  const invite = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await repo.inviteDeskOwner(email, name, role, role === 'cashier' ? outletIds : [])
      setEmail('')
      setName('')
      return `${roleLabel(role)} assigned to ${email.trim().toLowerCase()}. They get in after Google sign-in with that Gmail.`
    })
  }

  const toggleOutlet = (id: string) => {
    setOutletIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className={embedded ? 'settings-panel' : 'desk'}>
      {!embedded && (
        <header className="desk-hero">
          <div>
            <p className="eyebrow">Access</p>
            <h1>Manage account & roles</h1>
            <p className="muted">
              Owners assign managers (outlets + accounting) and cashiers (field POS only). Pending Google accounts
              cannot take money.
            </p>
          </div>
        </header>
      )}

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      <section className="card">
        <div className="card-head">
          <h2>Your account</h2>
        </div>
        <div className="account-grid">
          <p>
            <span className="muted tiny">Signed in</span>
            <strong>{user?.email || member?.email || '—'}</strong>
          </p>
          <p>
            <span className="muted tiny">Name</span>
            <strong>{member?.name || user?.displayName || '—'}</strong>
          </p>
          <p>
            <span className="muted tiny">Role</span>
            <strong>{member?.isPrimary ? 'Founding owner' : roleLabel(member?.role || 'owner')}</strong>
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Assign staff</h2>
        </div>
        <p className="muted">
          Owner — full desk. Manager — outlets and paid-in. Cashier — field POS only. They must sign in with that
          exact Google email.
        </p>
        <form className="composer role-form" onSubmit={invite}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Gmail to assign"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="owner">Owner — full desk</option>
            <option value="manager">Manager — outlets & accounting</option>
            <option value="cashier">Cashier — POS only</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Assign {roleLabel(role).toLowerCase()}
          </button>
        </form>
        {role === 'cashier' && activeOutlets.length > 0 && (
          <div className="chips" style={{ marginTop: '0.75rem' }}>
            <span className="muted tiny">Optional POS sites (empty = any outlet)</span>
            {activeOutlets.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`chip ${outletIds.includes(o.id) ? 'is-on' : ''}`}
                onClick={() => toggleOutlet(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Waiting on Google sign-in</h2>
        </div>
        {invites.length === 0 && <p className="muted">No open invites.</p>}
        {invites.map((inviteRow) => (
          <div key={inviteRow.id} className="member-row">
            <div>
              <strong>{inviteRow.name || inviteRow.email}</strong>
              <div className="muted tiny">
                {inviteRow.email} · {roleLabel(inviteRow.role)} · invited {fmtWhen(inviteRow.invitedAtMs)} by{' '}
                {inviteRow.invitedBy}
              </div>
            </div>
            <button
              className="btn btn-ghost danger"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await repo.revokeDeskInvite(inviteRow.email)
                  return 'Invite cancelled.'
                })
              }
            >
              Cancel
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Pending Google requests</h2>
          {pending.length > 0 && <span className="badge">{pending.length}</span>}
        </div>
        {pending.length === 0 && <p className="muted">Nobody is waiting. Unassigned Google sign-ins land here.</p>}
        {pending.map((row) => (
          <div key={row.id} className="member-row">
            <div>
              <strong>{row.name || row.email}</strong>
              <div className="muted tiny">
                {row.email} · requested {fmtWhen(row.requestedAtMs || row.lastSeenMs)}
              </div>
            </div>
            <div className="member-actions">
              <select value={approveRole} onChange={(e) => setApproveRole(e.target.value as StaffRole)}>
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
              </select>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repo.reviewDeskMember(row.uid, 'approved', '', approveRole)
                    return `${row.email} is now a ${roleLabel(approveRole).toLowerCase()}.`
                  })
                }
              >
                Approve
              </button>
              {rejectFor === row.uid ? (
                <form
                  className="reject-inline"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run(async () => {
                      await repo.reviewDeskMember(row.uid, 'rejected', reason)
                      setRejectFor(null)
                      setReason('')
                      return 'Desk access rejected.'
                    })
                  }}
                >
                  <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Reason" />
                  <button className="btn btn-ghost danger" type="submit" disabled={busy}>
                    Reject
                  </button>
                </form>
              ) : (
                <button className="btn btn-ghost" type="button" onClick={() => setRejectFor(row.uid)}>
                  Reject
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Staff</h2>
        </div>
        {staff.map((row) => (
          <div key={row.id} className="member-row">
            <div>
              <strong>{row.name || row.email}</strong>
              <div className="muted tiny">
                {row.email}
                {row.isPrimary ? ' · founding owner' : ` · ${roleLabel(row.role).toLowerCase()}`}
                {row.role === 'cashier' && row.outletIds.length > 0
                  ? ` · ${row.outletIds.length} assigned site${row.outletIds.length === 1 ? '' : 's'}`
                  : ''}
              </div>
            </div>
            {row.isPrimary || row.uid === user?.uid ? (
              <span className="pill ok">{row.isPrimary ? 'Locked' : 'You'}</span>
            ) : (
              <div className="member-actions">
                <select
                  defaultValue={row.role}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as StaffRole
                    void run(async () => {
                      await repo.setDeskMemberRole(row.uid, next, row.outletIds)
                      return `${row.email} is now a ${roleLabel(next).toLowerCase()}.`
                    })
                  }}
                >
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="cashier">Cashier</option>
                </select>
                <button
                  className="btn btn-ghost danger"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await repo.removeDeskOwner(row.uid)
                      return `${row.email} no longer has desk access.`
                    })
                  }
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </section>

      {rejected.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Turned down</h2>
          </div>
          {rejected.map((row) => (
            <div key={row.id} className="member-row">
              <div>
                <strong>{row.email}</strong>
                <div className="muted tiny">{row.rejectedReason || 'Rejected'}</div>
              </div>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repo.reviewDeskMember(row.uid, 'approved', '', 'cashier')
                    return `${row.email} is now a cashier.`
                  })
                }
              >
                Restore as cashier
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
