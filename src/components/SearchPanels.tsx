import type { SearchFailure } from '@/lib/pricing-types'
import { formatWait } from '@/lib/format'

const ERROR_TITLES: Record<string, string> = {
  invalid_query: 'Check your search',
  user_limit_reached: 'Daily search limit reached',
  global_budget_reached: 'Daily search budget reached',
  search_in_progress: 'This search is already running',
  not_configured: 'Live search is not configured',
}

export function ErrorPanel({ failure }: { failure: Pick<SearchFailure, 'code' | 'error' | 'retryAfterSeconds'> }) {
  return (
    <div data-testid="search-error" role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-foreground">{ERROR_TITLES[failure.code] ?? 'Search failed'}</p>
      <p className="mt-1 text-sm text-muted-foreground">{failure.error}</p>
      {failure.retryAfterSeconds ? (
        <p className="mt-1 text-xs text-muted-foreground">Retry in about {formatWait(failure.retryAfterSeconds)}.</p>
      ) : null}
    </div>
  )
}
