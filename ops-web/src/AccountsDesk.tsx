import { useEffect, useState, type FormEvent } from 'react'
import * as repo from './lib/repo'
import { fmtWhen } from './lib/desk'
import { useAuth } from './lib/authContext'
import type { DeskInvite, DeskMember } from './lib/types'

export function AccountsDesk({ embedded = false }: { embedded?: boolean }) {
  const { user, member } = useAuth()
  const [members, setMembers] = useState<DeskMember[]>([])
  const [invites, setInvites] = useState<DeskInvite[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [rejectFor, setRejectFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const u1 = repo.observeDeskMembers(setMembers)
    const u2 = repo.observeDeskInvites(setInvites)
    return () => {
      u1()
      u2()
    }
  }, [])

  const owners = members.filter((m) => m.role === 'owner')
  const pending = members.filter((m) => m.role === 'pending')
  const rejected = members.filter((m) => m.role === 'rejected')

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
      await repo.inviteDeskOwner(email, name)
      setEmail('')
      setName('')
      return `Owner access assigned to ${email.trim().toLowerCase()}. They get in after Google sign-in with that Gmail.`
    })
  }

  return (
    <div className={embedded ? 'settings-panel' : 'desk'}>
      {!embedded && (
        <header className="desk-hero">
          <div>
            <p className="eyebrow">Access</p>
            <h1>Manage account & roles</h1>
            <p className="muted">
              Google sign-in on this desk does not grant owner access by itself. Assign an owner email, or approve a
              pending request after they sign in.
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
            <strong>{member?.isPrimary ? 'Founding owner' : 'Owner'}</strong>
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Assign an owner</h2>
        </div>
        <p className="muted">
          They still have to sign in with Google on this desk using that exact email. Until then, they cannot open
          the roster.
        </p>
        <form className="composer role-form" onSubmit={invite}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Gmail to assign as owner"
          />
          <select disabled>
            <option>Owner — full desk</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Assign owner
          </button>
        </form>
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
                {inviteRow.email} · invited {fmtWhen(inviteRow.invitedAtMs)} by {inviteRow.invitedBy}
              </div>
            </div>
            <button
              className="btn btn-ghost danger"
              type="button"
              disabled={busy}
              onClick={() => void run(async () => {
                await repo.revokeDeskInvite(inviteRow.email)
                return 'Invite cancelled.'
              })}
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
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repo.reviewDeskMember(row.uid, 'approved')
                    return `${row.email} is now an owner.`
                  })
                }
              >
                Approve as owner
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
          <h2>Owners</h2>
        </div>
        {owners.map((row) => (
          <div key={row.id} className="member-row">
            <div>
              <strong>{row.name || row.email}</strong>
              <div className="muted tiny">
                {row.email}
                {row.isPrimary ? ' · founding owner' : ' · owner'}
              </div>
            </div>
            {row.isPrimary || row.uid === user?.uid ? (
              <span className="pill ok">{row.isPrimary ? 'Locked' : 'You'}</span>
            ) : (
              <button
                className="btn btn-ghost danger"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repo.removeDeskOwner(row.uid)
                    return `${row.email} no longer has owner access.`
                  })
                }
              >
                Remove
              </button>
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
                    await repo.reviewDeskMember(row.uid, 'approved')
                    return `${row.email} is now an owner.`
                  })
                }
              >
                Restore as owner
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
