import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ArchNode, TcdCheck, TcdCheckStatus } from './types'

export const ARCH_LAYOUT_VERSION = 'gn-arch-map-v1-20260815'

type NodeDef = {
  id: string
  label: string
  subtitle: string
  group: ArchNode['group']
  column: 'apps' | 'firebase' | 'cloudflare' | 'ops'
  checkIds?: string[]
  siteIds?: string[]
}

type FlowId =
  | 'onboard'
  | 'heartbeat'
  | 'pay'
  | 'extend'
  | 'issues'
  | 'chat'
  | 'alerts'
  | 'deploy'

type FlowGroupId = 'features' | 'ops'

type FlowMeta = {
  label: string
  hint: string
  steps: string[]
  nodeIds: string[]
}

const FLOW_GROUPS: { id: FlowGroupId; label: string; flows: FlowId[] }[] = [
  {
    id: 'features',
    label: 'Customer & provider features',
    flows: ['onboard', 'heartbeat', 'pay', 'extend', 'issues', 'chat', 'alerts'],
  },
  {
    id: 'ops',
    label: 'Ops',
    flows: ['deploy'],
  },
]

const COLUMNS: { id: NodeDef['column']; header: string; num: string }[] = [
  { id: 'apps', num: '1', header: 'Apps' },
  { id: 'firebase', num: '2', header: 'Firebase' },
  { id: 'cloudflare', num: '3', header: 'Cloudflare' },
  { id: 'ops', num: '4', header: 'Hosting & admin' },
]

const NODES: NodeDef[] = [
  {
    id: 'ops-web',
    label: 'Ops web',
    subtitle: 'Staff dashboard in the browser.',
    group: 'client',
    column: 'apps',
    siteIds: ['ops-web'],
  },
  {
    id: 'tcd-app',
    label: 'TCD console',
    subtitle: 'This operator dashboard you are using.',
    group: 'client',
    column: 'apps',
    siteIds: ['tcd-page'],
  },
  {
    id: 'customer-app',
    label: 'Customer app',
    subtitle: 'Flutter iOS & Android for subscribers.',
    group: 'client',
    column: 'apps',
    checkIds: ['customer-app'],
  },
  {
    id: 'firebase-auth',
    label: 'Firebase Auth',
    subtitle: 'Sign-in and secure account sessions.',
    group: 'firebase',
    column: 'firebase',
    checkIds: ['firebase-auth'],
  },
  {
    id: 'firestore',
    label: 'Firestore',
    subtitle: 'Customers, subscriptions, issues, and chat.',
    group: 'firebase',
    column: 'firebase',
    checkIds: ['firestore-org', 'customers-read'],
  },
  {
    id: 'fcm',
    label: 'Cloud Messaging',
    subtitle: 'Push notifications for expiry and chat.',
    group: 'firebase',
    column: 'firebase',
  },
  {
    id: 'functions',
    label: 'Cloud Functions',
    subtitle: 'Extend days, expire jobs, and server logic.',
    group: 'firebase',
    column: 'firebase',
    checkIds: ['functions-health'],
  },
  {
    id: 'firebase-hosting',
    label: 'Firebase Hosting',
    subtitle: 'Delivers the staff ops web to browsers.',
    group: 'hosting',
    column: 'firebase',
    siteIds: ['ops-web'],
  },
  {
    id: 'cf-worker',
    label: 'Cloudflare Worker',
    subtitle: 'Signed media API and edge routing.',
    group: 'edge',
    column: 'cloudflare',
    checkIds: ['platform-health', 'r2-proxy'],
  },
  {
    id: 'r2',
    label: 'R2 storage',
    subtitle: 'Issue photos and chat image blobs.',
    group: 'edge',
    column: 'cloudflare',
    checkIds: ['r2-proxy'],
  },
  {
    id: 'd1',
    label: 'D1 database',
    subtitle: 'Structured data at the edge.',
    group: 'edge',
    column: 'cloudflare',
    checkIds: ['platform-health'],
  },
  {
    id: 'kv',
    label: 'KV cache',
    subtitle: 'Fast edge key-value lookups.',
    group: 'edge',
    column: 'cloudflare',
    checkIds: ['platform-health'],
  },
  {
    id: 'gh-pages',
    label: 'GitHub Pages',
    subtitle: 'Public marketing site and docs.',
    group: 'hosting',
    column: 'ops',
    siteIds: ['marketing-site', 'tcd-page'],
  },
  {
    id: 'tcd',
    label: 'TCD console',
    subtitle: 'This operator dashboard you are using.',
    group: 'hosting',
    column: 'ops',
    siteIds: ['tcd-page'],
  },
  {
    id: 'droplet',
    label: 'DigitalOcean droplet',
    subtitle: 'Optional TURN, staging, backups — not required for ISP ops.',
    group: 'external',
    column: 'ops',
    checkIds: ['droplet'],
  },
]

const FLOW_META: Record<FlowId, FlowMeta> = {
  onboard: {
    label: 'Onboard customer',
    hint: 'How a new subscriber is created on the provider dashboard.',
    steps: [
      'Staff opens Accounts and creates a customer with name, phone, and plan.',
      'Cloud Functions write the customer record and optional Auth account.',
      'Firestore stores status, fee, and paidUntilMs for that subscriber.',
      'The customer app can sign in and see remaining service days.',
    ],
    nodeIds: ['ops-web', 'tcd-app', 'firebase-auth', 'firestore', 'functions', 'customer-app'],
  },
  heartbeat: {
    label: 'Heartbeat / online',
    hint: 'How the provider knows a customer app is reachable.',
    steps: [
      'The Flutter app writes lastSeenMs to the customer document.',
      'TCD and ops-web listen to customers in real time.',
      'Online is green when lastSeenMs is recent; stale means offline.',
    ],
    nodeIds: ['customer-app', 'firestore', 'ops-web', 'tcd-app'],
  },
  pay: {
    label: 'Pay and activate',
    hint: 'How a full fee starts or renews service.',
    steps: [
      'Staff records a full payment against a plan fee.',
      'extendSubscription stacks planDays onto paidUntilMs.',
      'Customer status becomes active and balanceDue clears.',
      'FCM notifies the customer that service is active.',
    ],
    nodeIds: ['ops-web', 'functions', 'firestore', 'fcm', 'customer-app'],
  },
  extend: {
    label: 'Partial fee / extend days',
    hint: 'How service continues when the customer cannot pay the full fee.',
    steps: [
      'Staff enters days to grant and the amount actually paid.',
      'If amountPaid is less than feeAmount, status becomes grace.',
      'paidUntilMs moves forward by N days from now or from the current expiry.',
      'A payment row and audit log capture the partial fee and remaining balance.',
    ],
    nodeIds: ['ops-web', 'tcd-app', 'functions', 'firestore', 'fcm', 'customer-app'],
  },
  issues: {
    label: 'Issue photos',
    hint: 'How a line-fault photo reaches staff.',
    steps: [
      'Customer captures a photo of the issue in the app.',
      'Cloudflare Worker issues a signed PUT to R2 after ID-token check.',
      'Issue metadata lands in Firestore with R2 object keys.',
      'Ops Issues tab shows the gallery for technicians.',
    ],
    nodeIds: ['customer-app', 'cf-worker', 'r2', 'firestore', 'ops-web'],
  },
  chat: {
    label: 'Support chat',
    hint: 'How customers talk to the service provider in real time.',
    steps: [
      'Customer or staff sends a message on the per-customer thread.',
      'The message writes to customers/{id}/chatMessages in Firestore.',
      'Cloud Messaging pushes the other party immediately.',
      'Chat images upload through the same R2 Worker.',
    ],
    nodeIds: ['customer-app', 'firestore', 'fcm', 'r2', 'cf-worker', 'ops-web'],
  },
  alerts: {
    label: 'Expiry alerts',
    hint: 'How customers are warned before service ends.',
    steps: [
      'A daily Cloud Function scans paidUntilMs and graceUntilMs.',
      'Statuses flip to grace or expired.',
      'FCM notifies the customer and flags the Accounts tab.',
    ],
    nodeIds: ['functions', 'firestore', 'fcm', 'customer-app', 'ops-web'],
  },
  deploy: {
    label: 'Website deploy',
    hint: 'How website builds reach production hosting.',
    steps: [
      'GitHub Actions builds the marketing site and TCD on push to main.',
      'Firebase Hosting serves the staff ops dashboard.',
      'Hard-refresh after deploy to load the latest architecture map.',
    ],
    nodeIds: ['gh-pages', 'tcd', 'firebase-hosting', 'ops-web'],
  },
}

const STATUS_RANK: Record<TcdCheckStatus, number> = { ok: 0, warn: 1, fail: 2 }

const STATUS_LABEL: Record<TcdCheckStatus, string> = {
  ok: 'OK',
  warn: 'WARN',
  fail: 'FAIL',
}

function worst(statuses: TcdCheckStatus[]): TcdCheckStatus {
  if (statuses.length === 0) return 'ok'
  return statuses.reduce((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc))
}

function resolveNodeStatus(
  node: NodeDef,
  checks: TcdCheck[],
  siteStatuses: Record<string, TcdCheckStatus>,
): TcdCheckStatus {
  const fromChecks = (node.checkIds ?? [])
    .map((id) => checks.find((c) => c.id === id))
    .filter((c): c is TcdCheck => Boolean(c) && (!c.optional || c.status === 'fail'))
    .map((c) => c.status)
  const fromSites = (node.siteIds ?? []).map((id) => siteStatuses[id] ?? 'ok')
  const all = [...fromChecks, ...fromSites]
  if (all.length === 0) {
    if (node.id === 'fcm') return 'ok'
    return 'warn'
  }
  return worst(all)
}

export function buildArchNodes(
  checks: TcdCheck[],
  siteStatuses: Record<string, TcdCheckStatus>,
): ArchNode[] {
  return NODES.map((n) => ({
    id: n.id,
    label: n.label,
    group: n.group,
    status: resolveNodeStatus(n, checks, siteStatuses),
    detail: checks
      .filter((c) => n.checkIds?.includes(c.id))
      .map((c) => `${c.label}: ${c.message}`)
      .join(' · '),
  }))
}

export function ArchitectureTree({
  nodes,
  selectedId,
  onSelect,
  loading = false,
}: {
  nodes: ArchNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading?: boolean
}) {
  const [activeFlow, setActiveFlow] = useState<FlowId | null>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setRevealed(true), 60)
    return () => window.clearTimeout(t)
  }, [])

  const archMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const highlightNodes = useMemo(() => {
    if (!activeFlow) return null
    return new Set(FLOW_META[activeFlow].nodeIds)
  }, [activeFlow])

  const toggleFlow = useCallback((flow: FlowId) => {
    setActiveFlow((prev) => (prev === flow ? null : flow))
  }, [])

  const selectFlow = useCallback((flow: FlowId | '') => {
    setActiveFlow(flow === '' ? null : flow)
  }, [])

  const probesPending = loading || nodes.length === 0
  const selected = selectedId ? archMap.get(selectedId) : null
  const activeMeta = activeFlow ? FLOW_META[activeFlow] : null

  return (
    <div className={`tcd-arch-wrap ${revealed ? 'is-revealed' : ''}`} data-arch-version={ARCH_LAYOUT_VERSION}>
      <p className="tcd-arch-intro">
        GlobalNetwork connects phones, cloud services, and hosting in four layers. Each card shows live
        health from probes — green is healthy, amber needs attention, red needs a fix. Pick a flow
        below to see how data moves for common tasks.
      </p>

      <div className="tcd-arch-toolbar">
        <label className="tcd-arch-flow-select-wrap">
          <span className="tcd-arch-flow-select-label">Choose a feature flow</span>
          <select
            className="tcd-arch-flow-select"
            value={activeFlow ?? ''}
            onChange={(e) => selectFlow(e.target.value as FlowId | '')}
            aria-label="Choose a feature flow"
          >
            <option value="">— Select to highlight data path —</option>
            {FLOW_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.flows.map((flow) => (
                  <option key={flow} value={flow}>
                    {FLOW_META[flow].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {FLOW_GROUPS.map((group) => (
          <div key={group.id} className="tcd-arch-flow-group">
            <p className="tcd-arch-flow-group-label">{group.label}</p>
            <div className="tcd-arch-flow-tabs" role="tablist" aria-label={`${group.label} flow guides`}>
              {group.flows.map((flow) => (
                <button
                  key={flow}
                  type="button"
                  role="tab"
                  aria-selected={activeFlow === flow}
                  className={`tcd-arch-flow-tab ${activeFlow === flow ? 'is-active' : ''}`}
                  onClick={() => toggleFlow(flow)}
                >
                  {FLOW_META[flow].label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <p className="tcd-arch-flow-hint">
          {activeMeta
            ? activeMeta.hint
            : 'Pick a flow above to highlight how data moves. Select any card for live probe details.'}
        </p>
      </div>

      {probesPending && (
        <div className="tcd-arch-loading" aria-live="polite">
          <span className="tcd-arch-loading-pulse" />
          Waiting for probe results — run a health check on Overview if badges stay amber.
        </div>
      )}

      <div className="tcd-arch-map-scroll">
        <div className="tcd-arch-map" role="list" aria-label="System architecture map">
          {COLUMNS.map((col, colIndex) => (
            <div key={col.id} className="tcd-arch-map-segment">
              {colIndex > 0 && (
                <div className="tcd-arch-step-arrow" aria-hidden="true">
                  <span className="tcd-arch-step-arrow-icon" />
                </div>
              )}
              <section className={`tcd-arch-step-col col-${col.id}`} aria-label={`${col.num}. ${col.header}`}>
                <header className="tcd-arch-step-header">
                  <span className="tcd-arch-step-num">{col.num}</span>
                  <span className="tcd-arch-step-title">{col.header}</span>
                </header>
                <div className="tcd-arch-step-cards">
                  {NODES.filter((n) => n.column === col.id).map((n) => {
                    const arch = archMap.get(n.id)
                    const status = arch?.status ?? 'warn'
                    const isSelected = selectedId === n.id
                    const inFlow = highlightNodes?.has(n.id) ?? false
                    const dimmed = highlightNodes != null && !inFlow
                    return (
                      <button
                        key={n.id}
                        type="button"
                        role="listitem"
                        className={[
                          'tcd-arch-component-card',
                          `group-${n.group}`,
                          `status-${status}`,
                          isSelected ? 'is-selected' : '',
                          inFlow ? 'is-flow-active' : '',
                          dimmed ? 'is-flow-dimmed' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => onSelect(n.id)}
                        aria-pressed={isSelected}
                        aria-label={`${n.label}, status ${STATUS_LABEL[status]}`}
                      >
                        <span className={`tcd-arch-status-pill status-${status}`} aria-hidden="true">
                          {STATUS_LABEL[status]}
                        </span>
                        <span className="tcd-arch-component-title">{n.label}</span>
                        <span className="tcd-arch-component-desc">{n.subtitle}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>
          ))}
        </div>
      </div>

      {activeMeta && (
        <div className="tcd-arch-data-flow" aria-live="polite">
          <h4 className="tcd-arch-data-flow-title">How data moves — {activeMeta.label}</h4>
          <ol className="tcd-arch-data-flow-list">
            {activeMeta.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="tcd-arch-legend">
        <span className="tcd-arch-legend-item">
          <span className="tcd-arch-legend-pill status-ok">OK</span> Healthy
        </span>
        <span className="tcd-arch-legend-item">
          <span className="tcd-arch-legend-pill status-warn">WARN</span> Check soon
        </span>
        <span className="tcd-arch-legend-item">
          <span className="tcd-arch-legend-pill status-fail">FAIL</span> Needs fix
        </span>
      </div>

      <div className={`tcd-arch-detail ${selected ? 'has-selection' : ''}`}>
        {selected ? (
          <>
            <strong className="tcd-arch-detail-name">{selected.label}</strong>
            <span className={`tcd-arch-detail-pill status-${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
            {selected.detail ? (
              <p className="tcd-arch-detail-text">{selected.detail}</p>
            ) : (
              <p className="tcd-arch-detail-text">No probe wired for this component — inferred healthy or not monitored.</p>
            )}
          </>
        ) : (
          <p className="tcd-arch-detail-empty">Select a component to see live probe details.</p>
        )}
      </div>
    </div>
  )
}
