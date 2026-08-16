import { Link } from 'react-router-dom'
import type { IssueTicket } from './lib/types'
import { setIssueStatus } from './lib/repo'
import { fmtWhen } from './lib/desk'

export function IssuesDesk({ issues }: { issues: IssueTicket[] }) {
  const open = issues.filter((i) => i.status !== 'resolved')
  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Field</p>
          <h1>Line issues</h1>
          <p className="muted">{open.length} open · photos from R2 if the customer attached them.</p>
        </div>
      </header>
      <div className="ticket-grid">
        {issues.map((issue) => (
          <article key={`${issue.customerId}-${issue.id}`} className="card ticket-card">
            <span className={`pill ${issue.status === 'resolved' ? 'ok' : issue.status === 'open' ? 'fail' : 'warn'}`}>{issue.status}</span>
            <h3>{issue.title}</h3>
            <p className="muted">
              <Link to={`/c/${issue.customerId}`}>{issue.customerName}</Link> · {fmtWhen(issue.createdAtMs)}
            </p>
            <p>{issue.body}</p>
            <div className="photos">
              {issue.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" />
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
                  {status.replace('_', ' ')}
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
