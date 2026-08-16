export type StaffRole = 'pending' | 'desk' | 'support' | 'admin'

export function parseRole(value: unknown): StaffRole {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
  if (v === 'admin') return 'admin'
  if (v === 'support') return 'support'
  if (v === 'pending') return 'pending'
  if (v === 'desk' || v === 'staff') return 'desk'
  return 'pending'
}

export function roleLabel(role: StaffRole | string | null | undefined): string {
  const parsed = parseRole(role)
  if (parsed === 'admin') return 'Control admin'
  if (parsed === 'desk') return 'Customer desk'
  if (parsed === 'support') return 'Support'
  return 'Awaiting role'
}

export function accessFromRole(role: StaffRole | null, owner: boolean) {
  const parsed = owner ? 'admin' : role
  return {
    isAdmin: owner || parsed === 'admin',
    canTcd: owner || parsed === 'admin',
    canDesk: owner || parsed === 'admin' || parsed === 'desk',
    canSupport: owner || parsed === 'admin' || parsed === 'desk' || parsed === 'support',
    pending: !owner && parsed === 'pending',
  }
}
