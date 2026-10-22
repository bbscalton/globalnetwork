import { useEffect, useSyncExternalStore } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Shared lock for desk buttons that send a command to the ER7206 (via er7206Queue jobs).
 * - Locks immediately on click (debounces double clicks).
 * - Stays locked until the queued job is confirmed done AND MIN_LOCK_MS passed; falls back
 *   to unlocking after MAX_LOCK_MS with a "still applying" note.
 * - State is module-level, keyed per user/customer + action, so it survives re-renders and remounts.
 * - `optimistic` holds the value the UI should show while the router applies the change.
 */
export const MIN_LOCK_MS = 30_000
export const MAX_LOCK_MS = 120_000

export type RouterLockEntry = {
  startMs: number
  jobId?: string | null
  jobDone: boolean
  optimistic?: unknown
  label?: string
  stillApplying?: boolean
  error?: string
  doneAtMs?: number
}

const entries = new Map<string, RouterLockEntry>()
const unsubs = new Map<string, () => void>()
const listeners = new Set<() => void>()
const doneHooks = new Map<string, () => void>()
let version = 0
let ticker: ReturnType<typeof setInterval> | null = null

const emit = () => {
  version += 1
  listeners.forEach((l) => l())
}

const PENDING = new Set(['pending', 'queued', 'running', 'processing', 'claimed', 'in_progress', 'working'])
const FAILED = new Set(['error', 'failed', 'failure'])

function finish(key: string, patch: Partial<RouterLockEntry>) {
  const e = entries.get(key)
  if (!e) return
  unsubs.get(key)?.()
  unsubs.delete(key)
  entries.set(key, { ...e, ...patch, doneAtMs: Date.now() })
  const hook = doneHooks.get(key)
  doneHooks.delete(key)
  hook?.()
  emit()
}

function tick() {
  const now = Date.now()
  let live = false
  for (const [key, e] of entries) {
    if (e.doneAtMs) {
      // keep finished notes around briefly, then clear
      if (now - e.doneAtMs > 15_000 && !e.error && !e.stillApplying) entries.delete(key)
      continue
    }
    live = true
    const age = now - e.startMs
    if (e.jobDone && age >= MIN_LOCK_MS) finish(key, {})
    else if (!e.jobId && age >= MIN_LOCK_MS) finish(key, {})
    else if (age >= MAX_LOCK_MS) finish(key, { stillApplying: true })
  }
  emit()
  if (!live && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function ensureTicker() {
  if (!ticker) ticker = setInterval(tick, 1000)
}

function watchJob(key: string, jobId: string) {
  if (!db) return
  unsubs.get(key)?.()
  const unsub = onSnapshot(
    doc(db, 'er7206Queue', jobId),
    (snap) => {
      const e = entries.get(key)
      if (!e || e.doneAtMs) return
      const data = snap.data() as Record<string, unknown> | undefined
      if (!data) return
      const status = String(data.status ?? '').toLowerCase()
      if (FAILED.has(status)) {
        finish(key, { error: String(data.error ?? data.lastError ?? data.message ?? `Router job ${status}`), optimistic: undefined })
      } else if (status && !PENDING.has(status)) {
        entries.set(key, { ...e, jobDone: true })
        if (Date.now() - e.startMs >= MIN_LOCK_MS) finish(key, {})
        else emit()
      }
    },
    () => {
      /* no read access / offline: fall back to the timer */
    },
  )
  unsubs.set(key, unsub)
}

export function isRouterLocked(key: string): boolean {
  const e = entries.get(key)
  return !!e && !e.doneAtMs
}

/**
 * Run a router command under the lock. `fn` returns the queued job id (or null if none).
 * Returns false if the key was already locked (double click) or the call failed.
 */
export async function runRouterCommand(
  key: string,
  fn: () => Promise<string | null | undefined>,
  opts: { optimistic?: unknown; label?: string; onDone?: () => void } = {},
): Promise<boolean> {
  if (isRouterLocked(key)) return false
  entries.set(key, { startMs: Date.now(), jobDone: false, optimistic: opts.optimistic, label: opts.label })
  if (opts.onDone) doneHooks.set(key, opts.onDone)
  ensureTicker()
  emit()
  try {
    const jobId = (await fn()) || null
    const e = entries.get(key)
    if (e) entries.set(key, { ...e, jobId })
    if (jobId) watchJob(key, jobId)
    emit()
    return true
  } catch (err) {
    doneHooks.delete(key)
    finish(key, { optimistic: undefined, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

export function clearRouterNote(key: string) {
  const e = entries.get(key)
  if (e?.doneAtMs) {
    entries.delete(key)
    emit()
  }
}

/** Subscribe a component to the lock store; returns helpers bound to the current time. */
export function useRouterLocks() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  useEffect(() => {
    if ([...entries.values()].some((e) => !e.doneAtMs)) ensureTicker()
  }, [])
  const get = (key: string) => entries.get(key)
  const locked = (key: string) => isRouterLocked(key)
  /** Button text while locked: "Applying… 23s" (counts down the minimum lock), then "Applying…". */
  const lockText = (key: string, idle: string) => {
    const e = entries.get(key)
    if (!e || e.doneAtMs) return idle
    const left = Math.ceil((MIN_LOCK_MS - (Date.now() - e.startMs)) / 1000)
    return left > 0 ? `${idle} · ${e.label ?? 'Applying…'} ${left}s` : `${idle} · ${e.label ?? 'Applying…'}`
  }
  /** Optimistic value while locked (or after the 2-min fallback until the next real sync). */
  const optimistic = <T,>(key: string): T | undefined => {
    const e = entries.get(key)
    if (!e || e.error) return undefined
    return e.optimistic as T | undefined
  }
  const note = (key: string): string | null => {
    const e = entries.get(key)
    if (!e) return null
    if (e.error) return `Router command failed: ${e.error}`
    if (e.stillApplying) return 'Still applying on the router (no confirmation after 2 min) — check again shortly.'
    return null
  }
  return { get, locked, lockText, optimistic, note }
}
