import { useEffect, useState } from 'react'
import {
  FIREBASE_AUTH_CONSOLE_URL,
  FIREBASE_FIRESTORE_CONSOLE_URL,
  FIREBASE_FUNCTIONS_CONSOLE_URL,
  FUNCTIONS_HEALTH_URL,
  GITHUB_REPO_URL,
  PLATFORM_HEALTH_URL,
} from './firebase'
import { observeAuditLogs, sendTestFcm } from './repo'
import type { AdminAuditLogEntry } from './types'

function timeAgo(ms: number | null | undefined): string {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function SystemPanel({
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
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([])
  const [fnHealth, setFnHealth] = useState('not checked')
  const [platHealth, setPlatHealth] = useState('not checked')

  useEffect(() => observeAuditLogs(setLogs), [])

  const checkHealth = async () => {
    onBusy(true)
    onError(null)
    try {
      const [fn, plat] = await Promise.all([
        FUNCTIONS_HEALTH_URL
          ? fetch(FUNCTIONS_HEALTH_URL).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
          : Promise.reject(new Error('VITE_FUNCTIONS_HEALTH_URL not set')),
        fetch(PLATFORM_HEALTH_URL).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
      ])
      setFnHealth(JSON.stringify(fn))
      setPlatHealth(JSON.stringify(plat))
      onStatus('Health probes completed.')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Health check failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="tcd-grid">
      <div className="tcd-card">
        <div className="tcd-card-head">
          <h2>System probes</h2>
        </div>
        <div className="tcd-hero-actions">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void checkHealth()}>
            Ping Functions + Worker
          </button>
          <button
            className="btn btn-ghost-on-dark"
            type="button"
            disabled={busy}
            onClick={() =>
              void sendTestFcm()
                .then(() => onStatus('Test FCM sent.'))
                .catch((e) => onError(e instanceof Error ? e.message : 'FCM failed'))
            }
          >
            Send test FCM
          </button>
        </div>
        <p className="muted small" style={{ marginTop: '1rem' }}>
          Functions: {fnHealth}
        </p>
        <p className="muted small">Worker: {platHealth}</p>
        <p className="muted small" style={{ marginTop: '1rem' }}>
          <a href={FIREBASE_AUTH_CONSOLE_URL} target="_blank" rel="noreferrer">
            Auth
          </a>
          {' · '}
          <a href={FIREBASE_FIRESTORE_CONSOLE_URL} target="_blank" rel="noreferrer">
            Firestore
          </a>
          {' · '}
          <a href={FIREBASE_FUNCTIONS_CONSOLE_URL} target="_blank" rel="noreferrer">
            Functions
          </a>
          {GITHUB_REPO_URL !== '#' && (
            <>
              {' · '}
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </>
          )}
        </p>
      </div>
      <div className="tcd-card">
        <div className="tcd-card-head">
          <h2>Audit log</h2>
        </div>
        <ul className="tcd-repair-log">
          {logs.map((l) => (
            <li key={l.id}>
              {timeAgo(l.atMs)} — {l.adminEmail} {l.action} {l.targetUid} {l.detail ?? ''}
            </li>
          ))}
          {logs.length === 0 && <li>No admin actions yet.</li>}
        </ul>
      </div>
    </div>
  )
}
