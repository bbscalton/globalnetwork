import { useEffect, useState } from 'react'
import { PLATFORM_HEALTH_URL, R2_BASE_URL } from './firebase'
import { getStorageDump } from './repo'
import type { StorageDump } from './types'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function StoragePanel({
  busy,
  onBusy,
  onError,
}: {
  busy: boolean
  onBusy: (v: boolean) => void
  onError: (msg: string | null) => void
}) {
  const [dump, setDump] = useState<StorageDump | null>(null)
  const [infra, setInfra] = useState('not checked')

  const load = async () => {
    onBusy(true)
    onError(null)
    try {
      const [next, health] = await Promise.all([
        getStorageDump(),
        fetch(PLATFORM_HEALTH_URL)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .catch((e) => ({ error: e instanceof Error ? e.message : 'probe failed' })),
      ])
      setDump(next)
      setInfra(JSON.stringify(health))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Storage dump failed')
    } finally {
      onBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="tcd-storage">
      <div className="tcd-card tcd-card-wide">
        <div className="tcd-card-head">
          <h2>R2 media</h2>
          <button className="btn btn-ghost-on-dark" type="button" disabled={busy} onClick={() => void load()}>
            Refresh dump
          </button>
        </div>
        <p className="muted small">
          Issue photos and chat images via {R2_BASE_URL}. Path: orgs/globalnetwork/customers/…/issues/…
        </p>
        {dump ? (
          <>
            <p style={{ marginTop: '1rem' }}>
              {dump.objects} objects · {fmtBytes(dump.bytes)}
              {dump.truncated ? ' · truncated listing' : ''}
            </p>
            <div className="tcd-storage-bar">
              <span style={{ width: `${Math.min(100, dump.bytes / (50 * 1024 * 1024) * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="tcd-empty-note">Storage dump not loaded. Worker /health must be reachable.</p>
        )}
        <pre className="muted small" style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
          Worker probe: {infra}
        </pre>
      </div>
    </div>
  )
}
