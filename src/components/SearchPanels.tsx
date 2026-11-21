import { CircleAlert } from 'lucide-react'
import type { SearchFailure } from '@/lib/pricing-types'
import { formatWait } from '@/lib/format'
import { Notice } from '@/components/dp/ui'

const ERROR_TITLES: Record<string, string> = {
  invalid_query: 'Check your search',
  user_limit_reached: 'Daily search limit reached',
  global_budget_reached: 'Daily search budget reached',
  search_in_progress: 'This search is already running',
  not_configured: 'Live search is not configured',
}

/** What the person can do next. The demo never uses a search, so it is always a safe fallback. */
const NEXT_STEP: Record<string, string> = {
  user_limit_reached: 'You can still explore the demo, or check live prices again tomorrow.',
  global_budget_reached: 'You can still explore the demo, or try live prices again tomorrow.',
  search_in_progress: 'Give it a moment; the result will be stored when it finishes.',
  not_configured: 'You can still explore the demo.',
}
const DEFAULT_NEXT_STEP = 'Try again in a minute, or explore the demo.'

export function ErrorPanel({ failure }: { failure: Pick<SearchFailure, 'code' | 'error' | 'retryAfterSeconds'> }) {
  return (
    <Notice testId="search-error" role="alert" tone="error" icon={CircleAlert} className="mt-6" title={ERROR_TITLES[failure.code] ?? 'Live prices could not be loaded'}>
      <p>{failure.error}</p>
      <p className="mt-1">{NEXT_STEP[failure.code] ?? DEFAULT_NEXT_STEP}</p>
      {failure.retryAfterSeconds ? <p className="mt-1 text-xs">Retry in about {formatWait(failure.retryAfterSeconds)}.</p> : null}
    </Notice>
  )
}
