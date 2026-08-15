import type { IssueTicket } from './types'

export function IssuesPanel({ issues }: { issues: IssueTicket[] }) {
  return (
    <div className="tcd-card tcd-card-wide">
      <div className="tcd-card-head">
        <h2>Issues</h2>
        <span className="tcd-card-timestamp">{issues.length} tickets · R2 photos</span>
      </div>
      {issues.length === 0 && <p className="tcd-empty-note">No customer issues yet.</p>}
      <div className="tcd-grid">
        {issues.map((issue) => (
          <article key={`${issue.customerId}-${issue.id}`} className="glass-card">
            <span className={`pill tcd-${issue.status === 'resolved' ? 'ok' : issue.status === 'open' ? 'fail' : 'warn'}`}>
              {issue.status}
            </span>
            <h3 style={{ marginTop: '0.6rem' }}>{issue.title}</h3>
            <p className="muted small">
              {issue.customerName} · {new Date(issue.createdAtMs).toLocaleString()}
            </p>
            <p style={{ marginTop: '0.6rem' }}>{issue.body}</p>
            <div className="tcd-issue-photos" style={{ marginTop: '0.75rem' }}>
              {issue.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" />
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
