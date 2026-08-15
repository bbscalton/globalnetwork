export const ADMIN_EMAIL = 'neuereatec@gmail.com'
export const ORG_ID = (import.meta.env.VITE_ORG_ID as string | undefined)?.trim() || 'globalnetwork'

export function isProjectAdmin(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === ADMIN_EMAIL
}
