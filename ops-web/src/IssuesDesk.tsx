import { Link } from 'react-router-dom'
import type { IssueTicket } from './lib/types'
import { AuthImage } from './lib/AuthImage'
import { setIssueStatus } from './lib/repo'
import { fmtWhen } from './lib/desk'

const ISSUE_LABEL: Record<IssueTicket['status'], string> = {
  open: 'Still open',
  in_progress: 'Ongoing',
  resolved: 'Resolved',
}

export function IssuesDesk({ issues }: { issues: IssueTicket[] }) {
  const open = issues.filter((i) => i.status !== 'resolved')
  const ongoing = issues.filter((i) => i.status === 'in_progress')
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
      </header>
      <div className="ticket-grid">
        {issues.map((issue) => (
          <article key={`${issue.customerId}-${issue.id}`} className="card ticket-card">
            <span className={`pill ${issue.status === 'resolved' ? 'ok' : issue.status === 'open' ? 'fail' : 'warn'}`}>
              {ISSUE_LABEL[issue.status]}
            </span>
            <h3>{issue.title}</h3>
            <p className="muted">
              <Link to={`/chat?c=${issue.customerId}`}>{issue.customerName}</Link>
              {' · '}
              <Link to={`/c/${issue.customerId}`}>record</Link>
              {' · '}
              {fmtWhen(issue.createdAtMs)}
            </p>
            <p>{issue.body}</p>
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
                  onClick={() => void setIssueStatus(issue.customerId, issue.id, status)}
                >
                  {ISSUE_LABEL[status]}
                </button>
              ))}
            </div>
          </article>
        ))}
        {issues.length === 0 && <p className="empty">No tickets yet.</p>}
      </div>
    </div>
  )
}
