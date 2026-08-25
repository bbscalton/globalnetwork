import type { Customer, CustomerStatus, IssueTicket } from './types'
import { daysLeft } from './repo'

/** Antigua / AST (UTC−4, no DST) — keep desk + customer app dates aligned. */
const ANTIGUA_TZ = 'America/Antigua'

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-GB', {
    timeZone: ANTIGUA_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function fmtWhen(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: ANTIGUA_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Desk label for remaining service — matches customer app (last paid day is not "off"). */
export function remainingLabel(paidUntilMs: number | null | undefined, now: number): string {
  const until = paidUntilMs ?? 0
  if (!until || until <= now) return 'Off network'
  const left = daysLeft(paidUntilMs ?? null, now)
  if (left <= 0) return 'Ends today'
  return left === 1 ? '1 day left' : `${left} days left`
}

export function remainingShort(paidUntilMs: number | null | undefined, now: number): string {
  const until = paidUntilMs ?? 0
  if (!until || until <= now) return 'Off network'
  const left = daysLeft(paidUntilMs ?? null, now)
  if (left <= 0) return 'Ends today'
  return `${left}d left`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'GN'
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function statusTone(status: CustomerStatus): 'ok' | 'warn' | 'fail' {
  if (status === 'active') return 'ok'
  if (status === 'grace') return 'warn'
  return 'fail'
}

export function cyclePct(customer: Customer, now: number): number {
  const left = Math.max(0, daysLeft(customer.paidUntilMs, now))
  const span = Math.max(customer.planDays || 1, 1)
  return Math.max(0, Math.min(100, Math.round((left / span) * 100)))
}

export type DeskPulse = {
  total: number
  active: number
  grace: number
  expired: number
  suspended: number
  dueSoon: Customer[]
  collections: Customer[]
  unread: Customer[]
  offline: Customer[]
  openIssues: number
  applications: Customer[]
  ringing: number
}

export function deskPulse(
  customers: Customer[],
  issues: IssueTicket[],
  now: number,
  onlineAfterMs: number,
  renewalWarnDays = 3,
): DeskPulse {
  const warnDays = Math.max(1, renewalWarnDays || 3)
  const dueSoon = customers
    .filter((c) => {
      const left = daysLeft(c.paidUntilMs, now)
      return left > 0 && left <= warnDays && c.status !== 'suspended'
    })
    .sort((a, b) => daysLeft(a.paidUntilMs, now) - daysLeft(b.paidUntilMs, now))
  const collections = customers.filter((c) => (c.balanceDue || 0) > 0 || c.status === 'grace')
  const unread = customers.filter((c) => (c.unreadStaff ?? 0) > 0)
  const offline = customers.filter((c) => c.status === 'active' && (!c.lastSeenMs || now - c.lastSeenMs > onlineAfterMs))
  const applications = customers.filter((c) => c.approvalStatus === 'pending')
  return {
    total: customers.length,
    active: customers.filter((c) => c.status === 'active').length,
    grace: customers.filter((c) => c.status === 'grace').length,
    expired: customers.filter((c) => c.status === 'expired').length,
    suspended: customers.filter((c) => c.status === 'suspended').length,
    dueSoon,
    collections,
    unread,
    offline,
    openIssues: issues.filter((i) => i.status !== 'resolved').length,
    applications,
    ringing: customers.filter((c) => c.callStatus === 'ringing' || c.callStatus === 'in_call').length,
  }
}
