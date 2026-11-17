import { collectionGroup, doc, onSnapshot, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { COL, db, functions } from './firebase'

/** customers/{id}/usage/current — written by the VPS connector from ER7206 IP Statistics. */
export type UsagePeriodKind = 'plan' | 'renewal' | 'extension' | 'reactivation' | 'adjust' | 'migrated'
export type UsagePeriodStatus = 'open' | 'closed'

export type UsagePeriodSummary = {
  startMs?: number | null
  endMs?: number | null
  kind?: UsagePeriodKind | string
  status?: UsagePeriodStatus | string
  downBytes?: number
  upBytes?: number
  countedFromMs?: number | null
  endedAtMs?: number | null
  endedReason?: string | null
  overageDownBytes?: number
  overageUpBytes?: number
  migrated?: boolean
}

export type CustomerUsage = {
  customerId: string
  userName?: string
  ip?: string | null
  online?: boolean
  month?: string
  monthDownBytes?: number
  monthUpBytes?: number
  months?: Record<string, { downBytes: number; upBytes: number }>
  totalDownBytes?: number
  totalUpBytes?: number
  rxBps?: number
  txBps?: number
  trackingSinceMs?: number
  updatedAtMs?: number
  periodId?: string | null
  periodStartMs?: number | null
  periodEndMs?: number | null
  periodKind?: UsagePeriodKind | string | null
  periodStatus?: UsagePeriodStatus | string | null
  periodDownBytes?: number
  periodUpBytes?: number
  periodCountedFromMs?: number | null
  periodEndedAtMs?: number | null
  periodEndedReason?: string | null
  overageDownBytes?: number
  overageUpBytes?: number
  periods?: Record<string, UsagePeriodSummary>
}

export type DataLimitAction = 'alert' | 'throttle' | 'cap'

/** Current calendar month in the router's zone (America/Guyana), e.g. 2026-10. */
export function currentMonth(now = Date.now()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guyana', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now))
  return `${p.find((x) => x.type === 'year')?.value}-${p.find((x) => x.type === 'month')?.value}`
}

/** Bytes used this calendar month (legacy buckets; kept for history). */
export function monthUsed(u: CustomerUsage | undefined, now = Date.now()): { down: number; up: number; total: number } {
  const b = u?.months?.[currentMonth(now)]
  const down = b?.downBytes ?? 0
  const up = b?.upBytes ?? 0
  return { down, up, total: down + up }
}

/** Bytes used in the current paid window (payment/renewal/extension). Falls back to calendar month if the connector has not written period fields yet. */
export function periodUsed(u: CustomerUsage | undefined, now = Date.now()): { down: number; up: number; total: number; fallback: 'period' | 'month' } {
  if (u && (u.periodId || u.periodStartMs || u.periodDownBytes != null || u.periodUpBytes != null)) {
    const down = Number(u.periodDownBytes ?? 0)
    const up = Number(u.periodUpBytes ?? 0)
    return { down, up, total: down + up, fallback: 'period' }
  }
  const m = monthUsed(u, now)
  return { ...m, fallback: 'month' }
}

const GUYANA_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Guyana', month: 'short', day: 'numeric', year: 'numeric' })

export function fmtPeriodRange(startMs?: number | null, endMs?: number | null): string {
  if (!startMs) return ''
  const start = GUYANA_DATE.format(new Date(startMs))
  if (!endMs) return `from ${start}`
  return `${start} – ${GUYANA_DATE.format(new Date(endMs))}`
}

export function periodHistory(u: CustomerUsage | undefined): Array<UsagePeriodSummary & { id: string }> {
  const map = u?.periods ?? {}
  return Object.entries(map)
    .map(([id, v]) => ({ id, ...(v || {}) }))
    .sort((a, b) => Number(b.startMs ?? 0) - Number(a.startMs ?? 0))
}

export function fmtBytes(n: number | undefined | null): string {
  const v = Number(n ?? 0)
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  return `${x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`
}

export const GB = 1024 ** 3

export function observeUsage(customerId: string, onData: (u: CustomerUsage | null) => void): Unsubscribe {
  if (!db) return () => undefined
  return onSnapshot(doc(db, COL.customers, customerId, 'usage', 'current'), (s) => {
    onData(s.exists() ? ({ customerId, ...(s.data() as Omit<CustomerUsage, 'customerId'>) }) : null)
  }, () => onData(null))
}

/** Staff: all customers' usage docs (collection group). */
export function observeAllUsage(onData: (byCustomer: Record<string, CustomerUsage>) => void): Unsubscribe {
  if (!db) return () => undefined
  return onSnapshot(collectionGroup(db, 'usage'), (snap) => {
    const out: Record<string, CustomerUsage> = {}
    snap.docs.forEach((d) => {
      const cid = d.ref.parent.parent?.id
      if (cid && d.id === 'current') out[cid] = { customerId: cid, ...(d.data() as Omit<CustomerUsage, 'customerId'>) }
    })
    onData(out)
  }, () => onData({}))
}

/** Desk-side data limit (stored on the customer doc; not a router setting). 0 / null = no limit. */
export async function setDataLimit(customerId: string, patch: {
  dataLimitGb: number | null
  dataLimitAction: DataLimitAction
  dataThrottleUpKbps?: number
  dataThrottleDownKbps?: number
}): Promise<void> {
  if (!db) throw new Error('Firestore not configured')
  await updateDoc(doc(db, COL.customers, customerId), patch)
}

/** Queue a per-user rate limit (throttle) or full-speed restore on the ER7206 local user. */
export async function setRouterSpeed(input: { customerId: string; action: 'throttle' | 'restore'; upBand?: number; downBand?: number }): Promise<{ ok: boolean; routerJobId: string }> {
  if (!functions) throw new Error('Functions not configured')
  const fn = httpsCallable(functions, 'er7206SetSpeed')
  return (await fn(input)).data as { ok: boolean; routerJobId: string }
}
