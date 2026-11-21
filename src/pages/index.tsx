/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 */

import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Seo } from '../components/Seo'
import { Pill } from '../components/dp/ui'
import { ProductIcon } from '../components/dp/ProductIcon'
import { BRAND_NAME } from '../constants'
import { CATALOG, variantSummary } from '../lib/catalog'
import { seo } from '../seo'

const STEPS = [
  { n: 1, title: 'Search and pick the model', text: 'Search by brand and model, then choose the exact product from what the price feed finds. Where it matters, choose the variant, such as storage size.' },
  { n: 2, title: 'We match every listing', text: 'Each retailer listing is checked against your model and variant using fixed rules on its title, with a stated reason for every decision.' },
  { n: 3, title: 'Compare what is comparable', text: 'See the lowest reported offer, a clear retailer table, and what still needs verification.' },
]

const PROMISES = [
  'Prices come from a retailer data feed and are not checked at checkout. Coverage depends on that feed.',
  'Listings are matched on their titles only: the feed has no barcodes or model numbers, so uncertain matches are labelled.',
  'Condition and shipping are shown only when a listing states them.',
  'Unusually low prices are flagged for a closer look, never labelled as fraud.',
  'There is no price history, so DealProof does not say whether a price is good over time.',
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
            <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="size-[18px]" aria-hidden />
              </span>
              {BRAND_NAME}
            </span>
            <Link to="/search" className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
              Open DealProof
            </Link>
          </div>
        </header>

        <main>
          <section className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            <div>
              <p className="text-sm font-medium text-primary">Price comparison for consumer products</p>
              <h1 className="mt-3 text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
                Compare prices without comparing the wrong products
              </h1>
              <p className="mt-4 max-w-lg text-lg text-muted-foreground">
                Search for a product, pick the exact model, and see retailer offers. DealProof is honest about what it cannot verify: variants, condition, shipping and price history.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/search" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
                  Compare prices <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a href="#how" className="inline-flex h-11 items-center rounded-lg border border-input bg-card px-5 text-sm font-medium text-foreground hover:bg-muted">
                  How it works
                </a>
              </div>
            </div>

            {/* Illustrative only: shows how listings are judged. No prices are shown. */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_4px_14px_rgba(18,23,34,0.06)]" aria-label="Example of how listings are judged">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Illustrative example · you chose 2TB, no heatsink</p>
              <ul className="mt-4 space-y-3">
                <li className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3">
                  <span className="min-w-0 text-sm text-foreground">“…990 PRO SSD 2TB (no heatsink)”</span>
                  <Pill tone="ok">Exact match</Pill>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3">
                  <span className="min-w-0 text-sm text-foreground">“…990 PRO 2TB NVMe M.2 SSD”</span>
                  <Pill tone="likely">Likely match</Pill>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3">
                  <span className="min-w-0 text-sm text-foreground">“…990 PRO 4TB with heatsink”</span>
                  <Pill tone="variant">Different variant</Pill>
                </li>
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">Only listings that really are your product are compared.</p>
            </div>
          </section>

          <section className="border-y border-border bg-card">
            <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
              <h2 className="text-2xl font-semibold text-foreground">Featured products</h2>
              <p className="mt-1 text-muted-foreground">Search for almost any product, or start with one of these. They have hand-written matching rules and a free demo.</p>
              <ul className="mt-6 grid gap-4 sm:grid-cols-3">
                {CATALOG.map((p) => (
                  <li key={p.key}>
                    <Link
                      to={`/search?product=${p.key}`}
                      className="group flex h-full flex-col rounded-2xl border border-border bg-background p-5 transition hover:border-primary/50 hover:shadow-[0_4px_14px_rgba(18,23,34,0.08)]"
                    >
                      <ProductIcon family={p.family} />
                      <span className="mt-4 text-xs text-muted-foreground">{p.brand}</span>
                      <span className="text-lg font-semibold text-foreground">{p.model}</span>
                      <span className="text-sm text-muted-foreground">{p.category}</span>
                      <span className="mt-3 flex-1 text-xs text-muted-foreground">{variantSummary(p.family)}</span>
                      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                        Compare <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section id="how" className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 className="text-2xl font-semibold text-foreground">How it works</h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-2xl border border-border bg-card p-5">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{s.n}</span>
                  <h3 className="mt-3 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
            <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
              <h2 className="text-xl font-semibold text-foreground">What DealProof is upfront about</h2>
              <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {PROMISES.map((t) => (
                  <li key={t} className="flex gap-2.5 text-sm text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>
      </div>
    </>
  )
}
