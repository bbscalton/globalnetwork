import { collectionGroup, doc, onSnapshot, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { COL, db, functions } from './firebase'

/** customers/{id}/usage/current — written by the VPS connector from ER7206 IP Statistics. */
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
}

export type DataLimitAction = 'alert' | 'throttle' | 'cap'

/** Current calendar month in the router's zone (America/Guyana), e.g. 2026-10. */
export function currentMonth(now = Date.now()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guyana', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now))
  return `${p.find((x) => x.type === 'year')?.value}-${p.find((x) => x.type === 'month')?.value}`
}

/** Bytes used this month (desk-side month selection; buckets are delta-based so router counter resets are safe). */
export function monthUsed(u: CustomerUsage | undefined, now = Date.now()): { down: number; up: number; total: number } {
  const b = u?.months?.[currentMonth(now)]
  const down = b?.downBytes ?? 0
  const up = b?.upBytes ?? 0
  return { down, up, total: down + up }
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
