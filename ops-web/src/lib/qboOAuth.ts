import * as repo from './repo'

/** Intuit redirects to /ops/?code=&state=&realmId= (query on the path, not the hash). */
export function readQboOAuthCallback(): {
  code?: string
  state?: string
  realmId?: string
  error?: string
  errorDescription?: string
} | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')?.trim() || undefined
  const state = params.get('state')?.trim() || undefined
  const realmId = params.get('realmId')?.trim() || undefined
  const error = params.get('error')?.trim() || undefined
  const errorDescription = params.get('error_description')?.trim() || undefined
  if (!code && !state && !realmId && !error) return null
  return { code, state, realmId, error, errorDescription }
}

export function clearQboOAuthQuery(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  ;['code', 'state', 'realmId', 'error', 'error_description'].forEach((key) => url.searchParams.delete(key))
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, document.title, next || url.pathname)
}

/** Completes Intuit OAuth when the redirect query is present. Returns a success message. */
export async function completeQboOAuthIfPresent(): Promise<string | null> {
  const payload = readQboOAuthCallback()
  if (!payload) return null
  clearQboOAuthQuery()
  await repo.qboCompleteConnect(payload)
  return 'QuickBooks company connected.'
}
