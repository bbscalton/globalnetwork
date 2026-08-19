import type { User } from 'firebase/auth'

export const ADMIN_EMAIL = 'neuereatec@gmail.com'
export const ORG_ID = (import.meta.env.VITE_ORG_ID as string | undefined)?.trim() || 'globalnetwork'
export const POS_WEB_URL = (import.meta.env.VITE_POS_WEB_URL as string | undefined)?.trim() || '/globalnetwork/pos/'
export const R2_BASE =
  (import.meta.env.VITE_R2_BASE as string | undefined)?.trim() || 'https://globalnetwork-media.neuereatec.workers.dev'

export function userEmails(user: User | null | undefined): string[] {
  const raw = [user?.email, ...(user?.providerData.map((p) => p.email) ?? [])]
  return raw.map((email) => (email ?? '').trim().toLowerCase()).filter(Boolean)
}

export function isProjectAdmin(emailOrUser: string | User | null | undefined): boolean {
  if (!emailOrUser) return false
  if (typeof emailOrUser === 'string') return emailOrUser.trim().toLowerCase() === ADMIN_EMAIL
  return userEmails(emailOrUser).includes(ADMIN_EMAIL)
}
