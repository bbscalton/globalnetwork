import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, FIREBASE_CONFIGURED } from './firebase'

export type PublicPlan = {
  id: string
  name: string
  days: number
  feeAmount: number
  currency: string
  active: boolean
}

export function formatEc(amount: number): string {
  return `EC$${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Live active plans from the same Firestore catalog as the owner Plans desk. */
export function usePublicPlans(): {
  plans: PublicPlan[]
  loading: boolean
  error: string | null
  configured: boolean
} {
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [loading, setLoading] = useState(FIREBASE_CONFIGURED)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!db) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const unsub = onSnapshot(
      collection(db, 'plans'),
      (snap) => {
        const rows = snap.docs
          .map((d) => {
            const data = d.data()
            return {
              id: d.id,
              name: String(data.name ?? ''),
              days: Number(data.days ?? 0),
              feeAmount: Number(data.feeAmount ?? 0),
              currency: String(data.currency ?? 'XCD'),
              active: data.active !== false,
            }
          })
          .filter((p) => p.active && p.days > 0)
          .sort((a, b) => a.days - b.days || a.feeAmount - b.feeAmount || a.name.localeCompare(b.name))
        setPlans(rows)
        setError(null)
        setLoading(false)
      },
      (e) => {
        setError(e.message || 'Could not load plans')
        setLoading(false)
      },
    )
    return () => unsub()
  }, [])

  return { plans, loading, error, configured: FIREBASE_CONFIGURED }
}
