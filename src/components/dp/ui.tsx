/**
 * DealProof design-system primitives.
 *
 * Small, presentation-only building blocks shared by every screen, so status
 * colours, disclosures and controls look and behave the same everywhere:
 *   Pill              compact status label (icon + text, never colour alone)
 *   Notice            a callout (caution / info / error)
 *   Disclosure        a bordered, collapsible section (native <details>)
 *   More              a light inline "why?" disclosure
 *   SegmentedControl  an accessible radio group for choosing one of a few options
 *   Skeleton          loading placeholder
 * Tones map to semantic theme tokens (see themes.css), not to raw colours.
 */

import { useId, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'likely' | 'caution' | 'variant' | 'neutral' | 'info'
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const PILL: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  likely: 'bg-likely-soft text-likely',
  caution: 'bg-caution-soft text-caution',
  variant: 'bg-variant-soft text-variant',
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-likely-soft text-likely',
}

export function Pill({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
  title,
  testId,
}: {
  tone?: Tone
  icon?: Icon
  children: ReactNode
  className?: string
  title?: string
  testId?: string
}) {
  return (
    <span
      title={title}
      data-testid={testId}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', PILL[tone], className)}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  )
}

const NOTICE: Record<'caution' | 'info' | 'error' | 'neutral', string> = {
  caution: 'border-caution-line bg-caution-soft text-foreground [&_svg.lead]:text-caution',
  info: 'border-likely/25 bg-likely-soft text-foreground [&_svg.lead]:text-likely',
  error: 'border-destructive/30 bg-destructive/5 text-foreground [&_svg.lead]:text-destructive',
  neutral: 'border-border bg-card text-foreground [&_svg.lead]:text-muted-foreground',
}

export function Notice({
  tone = 'neutral',
  icon: Icon,
  title,
  children,
  role,
  testId,
  className,
}: {
  tone?: keyof typeof NOTICE
  icon?: Icon
  title?: ReactNode
  children?: ReactNode
  role?: 'note' | 'alert' | 'status'
  testId?: string
  className?: string
}) {
  return (
    <div role={role} data-testid={testId} className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', NOTICE[tone], className)}>
      {Icon && <Icon className="lead mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-muted-foreground [&_strong]:text-foreground')}>{children}</div>}
      </div>
    </div>
  )
}

export function Disclosure({
  summary,
  meta,
  children,
  defaultOpen,
  tone,
  testId,
  className,
}: {
  summary: ReactNode
  /** Right-aligned secondary text in the header (e.g. a count). */
  meta?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  tone?: 'caution'
  testId?: string
  className?: string
}) {
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className={cn('group overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(18,23,34,0.05)]', tone === 'caution' ? 'border-caution-line' : 'border-border', className)}
    >
      <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3.5 text-base font-semibold text-foreground hover:bg-muted/50 sm:px-5">
        <span className="min-w-0 flex-1">{summary}</span>
        {meta != null && <span className="text-sm font-normal text-muted-foreground">{meta}</span>}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {children}
    </details>
  )
}

/** A light inline disclosure for secondary explanations ("Why this is flagged"). */
export function More({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn('group text-sm', className)}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 font-medium text-primary hover:underline">
        {label}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2 text-muted-foreground">{children}</div>
    </details>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

/** One choice out of a few. Arrow keys move the selection (radio-group pattern). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
  className,
}: {
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  testId: string
  className?: string
}) {
  const id = useId()
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = options[(i + step + options.length) % options.length]
    onChange(next.value)
    ;(e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div role="radiogroup" aria-labelledby={`${id}-label`} data-testid={testId} className={className}>
      <p id={`${id}-label`} className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5 inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1">
        {options.map((o, i) => {
          const checked = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              data-value={o.value}
              data-testid={`${testId}-${o.value}`}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => move(e, i)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                checked ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-muted', className)} />
}

/** Standard page width + padding so every screen lines up. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10', className)}>{children}</div>
}
