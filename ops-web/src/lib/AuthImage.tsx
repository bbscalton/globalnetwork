import { useEffect, useState } from 'react'
import { auth } from './firebase'

export function AuthImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    let objectUrl = ''
    void (async () => {
      try {
        const token = await auth?.currentUser?.getIdToken()
        const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
        if (!res.ok) return
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!gone) setSrc(objectUrl)
      } catch {
        if (!gone) setSrc(null)
      }
    })()
    return () => {
      gone = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  if (!src) return <div className="kyc-placeholder">Loading photo…</div>
  return <img className={className || 'kyc-photo'} src={src} alt={alt} />
}
