import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { COL, db, FIREBASE_CONFIGURED, FUNCTIONS_HEALTH_URL, MARKETING_URL, OPS_WEB_URL, PLATFORM_HEALTH_URL, R2_BASE_URL, TCD_URL, functions } from './firebase'
import { ORG_ID } from './admin'
import type {
  AdminAuditLogEntry,
  ChatMessage,
  Customer,
  CustomerStatus,
  IssueTicket,
  Plan,
  SiteUptime,
  StorageDump,
  TcdCheck,
  TcdCheckStatus,
  TcdReport,
} from './types'

function requireDb() {
  if (!db) throw new Error('Firestore is not configured.')
  return db
}

function asCustomer(id: string, data: Record<string, unknown>): Customer {
  return {
    id,
    name: String(data.name ?? ''),
    phone: String(data.phone ?? ''),
    email: String(data.email ?? ''),
    address: String(data.address ?? ''),
    status: (data.status as CustomerStatus) || 'expired',
    planId: String(data.planId ?? ''),
    planName: String(data.planName ?? ''),
    planDays: Number(data.planDays ?? 30),
    feeAmount: Number(data.feeAmount ?? 0),
    paidAmount: Number(data.paidAmount ?? 0),
    balanceDue: Number(data.balanceDue ?? 0),
    paidUntilMs: data.paidUntilMs == null ? null : Number(data.paidUntilMs),
    graceUntilMs: data.graceUntilMs == null ? null : Number(data.graceUntilMs),
    lastSeenMs: Number(data.lastSeenMs ?? 0),
    unreadStaff: Number(data.unreadStaff ?? 0),
    createdAtMs: Number(data.createdAtMs ?? 0),
    uid: data.uid == null ? null : String(data.uid),
  }
}

export function observeCustomers(orgId: string, onData: (rows: Customer[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.customers), orderBy('createdAtMs', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>
        return { customer: asCustomer(d.id, data), org: String(data.orgId ?? orgId) }
      })
      onData(rows.filter((r) => !orgId || r.org === orgId).map((r) => r.customer))
    },
    (e) => onError?.(e),
  )
}

export function observePlans(onData: (rows: Plan[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(
    collection(database, COL.plans),
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            name: String(data.name ?? ''),
            days: Number(data.days ?? 30),
            feeAmount: Number(data.feeAmount ?? 0),
            currency: String(data.currency ?? 'GYD'),
            active: data.active !== false,
          }
        }),
      )
    },
    (e) => onError?.(e),
  )
}

export function observeChat(customerId: string, onData: (rows: ChatMessage[]) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.customers, customerId, COL.chatMessages), orderBy('createdAtMs', 'asc'))
  return onSnapshot(q, (snap) => {
    onData(
      snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          from: data.from === 'staff' ? 'staff' : 'customer',
          text: String(data.text ?? ''),
          mediaUrl: data.mediaUrl == null ? null : String(data.mediaUrl),
          createdAtMs: Number(data.createdAtMs ?? 0),
        }
      }),
    )
  })
}

export function observeIssues(onData: (rows: IssueTicket[]) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(collection(database, COL.customers), async (custSnap) => {
    const tickets: IssueTicket[] = []
    for (const c of custSnap.docs) {
      const issues = await getDocs(query(collection(c.ref, COL.issues), orderBy('createdAtMs', 'desc')))
      for (const i of issues.docs) {
        const data = i.data()
        tickets.push({
          id: i.id,
          customerId: c.id,
          customerName: String(c.data().name ?? ''),
          title: String(data.title ?? ''),
          body: String(data.body ?? ''),
          status: (data.status as IssueTicket['status']) || 'open',
          photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls.map(String) : [],
          createdAtMs: Number(data.createdAtMs ?? 0),
        })
      }
    }
    tickets.sort((a, b) => b.createdAtMs - a.createdAtMs)
    onData(tickets)
  })
}

export function observeAuditLogs(onData: (rows: AdminAuditLogEntry[]) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.adminAuditLogs), orderBy('atMs', 'desc'))
  return onSnapshot(q, (snap) => {
    onData(
      snap.docs.slice(0, 40).map((d) => {
        const data = d.data()
        return {
          id: d.id,
          action: String(data.action ?? ''),
          adminEmail: String(data.adminEmail ?? ''),
          targetUid: String(data.targetUid ?? ''),
          detail: data.detail == null ? undefined : String(data.detail),
          atMs: Number(data.atMs ?? 0),
        }
      }),
    )
  })
}

export async function sendChat(customerId: string, text: string, from: 'staff' | 'customer'): Promise<void> {
  const database = requireDb()
  await addDoc(collection(database, COL.customers, customerId, COL.chatMessages), {
    from,
    text,
    createdAtMs: Date.now(),
  })
}

export async function updateCustomerContact(
  customerId: string,
  patch: { name?: string; phone?: string; email?: string; address?: string; planId?: string; planName?: string; planDays?: number; feeAmount?: number },
): Promise<void> {
  const database = requireDb()
  await updateDoc(doc(database, COL.customers, customerId), patch)
}

async function callable<Req extends object, Res>(name: string, data: Req): Promise<Res> {
  if (!functions) throw new Error('Cloud Functions are not configured.')
  const fn = httpsCallable<Req, Res>(functions, name)
  const res = await fn(data)
  return res.data
}

export async function createCustomer(input: {
  name: string
  phone: string
  email: string
  address: string
  planId: string
}): Promise<{ customerId: string }> {
  return callable('createCustomer', { ...input, orgId: ORG_ID })
}

export async function extendSubscription(input: {
  customerId: string
  days: number
  amountPaid: number
  note: string
}): Promise<{ paidUntilMs: number; status: CustomerStatus; balanceDue: number }> {
  return callable('extendSubscription', input)
}

export async function suspendCustomer(customerId: string): Promise<void> {
  await callable('suspendCustomer', { customerId })
}

export async function savePlan(plan: Omit<Plan, 'id'> & { id?: string }): Promise<void> {
  await callable('savePlan', plan)
}

export async function sendTestFcm(): Promise<void> {
  await callable('adminSendTestFcm', { orgId: ORG_ID })
}

export async function getStorageDump(): Promise<StorageDump> {
  try {
    return await callable('adminGetStorageDump', {})
  } catch {
    const res = await fetch(`${R2_BASE_URL.replace(/\/$/, '')}/storage-dump`)
    if (!res.ok) throw new Error(`Storage dump HTTP ${res.status}`)
    return (await res.json()) as StorageDump
  }
}

async function probeUrl(id: string, label: string, url: string, group: TcdCheck['group']): Promise<TcdCheck> {
  const started = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' })
    const latencyMs = Date.now() - started
    const status: TcdCheckStatus = res.ok || res.status === 404 ? 'ok' : res.status >= 500 ? 'fail' : 'warn'
    return { id, label, group, status, message: `HTTP ${res.status}`, latencyMs }
  } catch (e) {
    return {
      id,
      label,
      group,
      status: 'warn',
      message: e instanceof Error ? e.message : 'Unreachable (CORS or network)',
      latencyMs: Date.now() - started,
    }
  }
}

export async function loadSiteUptime(): Promise<SiteUptime[]> {
  const targets = [
    { id: 'marketing-site', label: 'GitHub Pages marketing', url: MARKETING_URL },
    { id: 'tcd-page', label: 'TCD console', url: TCD_URL },
    { id: 'ops-web', label: 'Ops web', url: OPS_WEB_URL },
  ]
  const results: SiteUptime[] = []
  for (const t of targets) {
    const check = await probeUrl(t.id, t.label, t.url, 'uptime')
    results.push({ ...t, status: check.status, message: check.message, latencyMs: check.latencyMs })
  }
  return results
}

export async function runTcdHealthCheck(): Promise<TcdReport> {
  const checks: TcdCheck[] = []
  checks.push({
    id: 'firebase-auth',
    label: 'Firebase Auth',
    group: 'platform',
    status: FIREBASE_CONFIGURED ? 'ok' : 'fail',
    message: FIREBASE_CONFIGURED ? 'Client SDK configured.' : 'Missing VITE_FIREBASE_* env.',
  })

  if (db) {
    const started = Date.now()
    try {
      await getDocs(query(collection(db, COL.customers)))
      checks.push({
        id: 'customers-read',
        label: 'Customers',
        group: 'fleet',
        status: 'ok',
        message: 'Customer collection readable.',
        latencyMs: Date.now() - started,
      })
      checks.push({
        id: 'firestore-org',
        label: 'Firestore',
        group: 'platform',
        status: 'ok',
        message: 'Org data reachable.',
        latencyMs: Date.now() - started,
      })
    } catch (e) {
      checks.push({
        id: 'customers-read',
        label: 'Customers',
        group: 'fleet',
        status: 'fail',
        message: e instanceof Error ? e.message : 'Firestore read failed',
        latencyMs: Date.now() - started,
      })
      checks.push({
        id: 'firestore-org',
        label: 'Firestore',
        group: 'platform',
        status: 'fail',
        message: 'Could not read customers.',
        latencyMs: Date.now() - started,
      })
    }
  } else {
    checks.push({
      id: 'firestore-org',
      label: 'Firestore',
      group: 'platform',
      status: 'fail',
      message: 'Firestore client missing.',
    })
  }

  if (FUNCTIONS_HEALTH_URL) {
    checks.push(await probeUrl('functions-health', 'Cloud Functions', FUNCTIONS_HEALTH_URL, 'platform'))
  } else {
    checks.push({
      id: 'functions-health',
      label: 'Cloud Functions',
      group: 'platform',
      status: 'warn',
      message: 'VITE_FUNCTIONS_HEALTH_URL not set.',
    })
  }

  checks.push(await probeUrl('platform-health', 'Cloudflare Worker', PLATFORM_HEALTH_URL, 'platform'))
  checks.push(await probeUrl('r2-proxy', 'R2 proxy', `${R2_BASE_URL.replace(/\/$/, '')}/health`, 'platform'))
  checks.push({
    id: 'customer-app',
    label: 'Customer app',
    group: 'fleet',
    status: 'warn',
    message: 'Flutter app not published yet — scaffold is in customer-app/.',
    optional: true,
  })
  checks.push({
    id: 'droplet',
    label: 'DigitalOcean droplet',
    group: 'platform',
    status: 'warn',
    message: 'Optional for ISP ops. Not required unless you add TURN/staging later.',
    optional: true,
  })

  return { generatedAtMs: Date.now(), checks }
}

export async function runAutoRepair(): Promise<string[]> {
  const logs: string[] = []
  try {
    await callable('ensureOrgDefaults', { orgId: ORG_ID })
    logs.push('Ensured org defaults and starter plans (15/30/90 days).')
  } catch (e) {
    logs.push(e instanceof Error ? `ensureOrgDefaults: ${e.message}` : 'ensureOrgDefaults failed')
  }
  return logs
}

export function formatGyd(amount: number): string {
  return `G$${amount.toLocaleString()}`
}

export function daysLeft(paidUntilMs: number | null, now: number): number {
  if (!paidUntilMs) return 0
  return Math.ceil((paidUntilMs - now) / (24 * 60 * 60 * 1000))
}
