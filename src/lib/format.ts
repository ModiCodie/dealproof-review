/** Small display helpers shared by the search and saved-product pages. */

export function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

export function formatWait(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour(s)`
  if (seconds >= 60) return `${Math.round(seconds / 60)} minute(s)`
  return `${seconds} seconds`
}

/** "3 hours ago", used only to make stale data obvious. Falls back to null for bad input. */
export function formatAge(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`
  if (s < 129_600) return `${Math.round(s / 3600)} hours ago`
  return `${Math.round(s / 86_400)} days ago`
}

/** "Nov 19, 2026" (locale-aware date, no time). */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
