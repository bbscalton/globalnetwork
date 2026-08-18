import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { IssueTicket } from './lib/types'
import { AuthImage } from './lib/AuthImage'
import * as repo from './lib/repo'
import { fmtWhen } from './lib/desk'

const ISSUE_LABEL: Record<IssueTicket['status'], string> = {
  open: 'Still open',
  in_progress: 'Ongoing',
  resolved: 'Resolved',
}

export function IssuesDesk({ issues }: { issues: IssueTicket[] }) {
  const open = issues.filter((i) => i.status !== 'resolved')
  const ongoing = issues.filter((i) => i.status === 'in_progress')
  const resolved = issues.filter((i) => i.status === 'resolved')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const issueKey = (issue: IssueTicket) => `${issue.customerId}:${issue.id}`

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const result = await work()
      if (result) setMsg(result)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Field</p>
          <h1>Line issues</h1>
          <p className="muted">
            {open.length} still open · {ongoing.length} ongoing. Pin colors on the{' '}
            <Link to="/field">field map</Link> follow the same states.
          </p>
        </div>
        <button
          className="btn btn-ghost danger"
          type="button"
          disabled={busy || resolved.length === 0}
          onClick={() => {
            if (!window.confirm(`Delete ${resolved.length} resolved ticket${resolved.length === 1 ? '' : 's'}?`)) return
            void run(async () => {
              const res = await repo.tidyDesk({ action: 'deleteResolvedIssues' })
              return `Deleted ${res.deleted} resolved ticket${res.deleted === 1 ? '' : 's'}.`
            })
          }}
        >
          Delete resolved
        </button>
      </header>
      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}
      <div className="ticket-grid">
        {issues.map((issue) => (
          <article key={`${issue.customerId}-${issue.id}`} className="card ticket-card">
            <span className={`pill ${issue.status === 'resolved' ? 'ok' : issue.status === 'open' ? 'fail' : 'warn'}`}>
              {ISSUE_LABEL[issue.status]}
            </span>
            {editId === issueKey(issue) ? (
              <>
                <label>
                  Title
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label>
                  Details
                  <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
                </label>
                <div className="quick-renew" style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await repo.updateIssue(issue.customerId, issue.id, { title, body })
                        setEditId(null)
                      })
                    }
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => setEditId(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>{issue.title}</h3>
                <p className="muted">
                  <Link to={`/chat?c=${issue.customerId}`}>{issue.customerName}</Link>
                  {' · '}
                  <Link to={`/c/${issue.customerId}`}>record</Link>
                  {' · '}
                  {fmtWhen(issue.createdAtMs)}
                </p>
                <p>{issue.body}</p>
              </>
            )}
            <div className="photos">
              {issue.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <AuthImage url={url} alt="" className="issue-thumb" />
                </a>
              ))}
            </div>
            <div className="chips">
              {(['open', 'in_progress', 'resolved'] as const).map((status) => (
                <button
                  key={status}
                  className={`chip ${issue.status === status ? 'is-on' : ''}`}
                  type="button"
                  onClick={() => void run(async () => { await repo.setIssueStatus(issue.customerId, issue.id, status) })}
                >
                  {ISSUE_LABEL[status]}
                </button>
              ))}
            </div>
            {editId !== issueKey(issue) && (
              <div className="bubble-actions">
                <button
                  type="button"
                  onClick={() => {
                    setEditId(issueKey(issue))
                    setTitle(issue.title)
                    setBody(issue.body)
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Delete this ticket?')) return
                    void run(async () => {
                      await repo.deleteIssue(issue.customerId, issue.id)
                      return 'Ticket deleted'
                    })
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </article>
        ))}
        {issues.length === 0 && <p className="empty">No tickets yet.</p>}
      </div>
    </div>
  )
}
