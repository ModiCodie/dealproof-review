#!/usr/bin/env node
// DealProof feasibility experiment against PricesAPI. Zero dependencies (Node 18+ built-in fetch).
// Usage: node run.mjs <check|catalog|search|snapshot|history|spotcheck|analyze|all> [--force]
// The API key is read ONLY from the PRICESAPI_KEY environment variable and is never logged or saved.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const RAW = path.join(OUT, 'raw');           // full responses (gitignored)
const EXAMPLES = path.join(HERE, 'examples'); // sanitized, truncated responses (safe to commit)
const LEDGER = path.join(OUT, 'ledger.json');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(EXAMPLES, { recursive: true });

// ---------------------------------------------------------------- configuration
const BASE = 'https://api.pricesapi.io/api/v1';
const MARKET = 'us';
const BUDGET = 60;                                   // hard cap on credits for the whole experiment
const CAPS = { search: 3, snapshot: 3, history: 2 }; // max logical calls per endpoint
const COST = { search: 10, snapshot: 1, history: 7, catalog: 0 }; // worst-case reservation per call
const HISTORY_DAYS = 7;
const STALE_AFTER_S = 48 * 3600;

// ---------------------------------------------------------------- matching rules
// Each rule inspects an offer's title and returns:
//   cls: 'match' (requested model + variant, new), 'variant' (right model, different variant/condition),
//        'ambiguous' (cannot tell), 'mismatch' (wrong model/capacity/accessory)
const CONDITION_RE = /\b(refurbished|recertified|reconditioned|refurb|renewed|used|pre-?owned|open[\s-]?box|like new)\b/i;
const ACCESSORY_RE = /\b(replacement|ear\s?pads?|ear\s?cushions?|cushions?|skins?|covers?|grips?|mouse\s?pads?|cables?|stand|strap|case only)\b/i;

function conditionVariant(t) {
  const m = t.match(CONDITION_RE);
  return m ? `condition:${m[1].toLowerCase()}` : null;
}

const PRODUCTS = [
  {
    key: 'sony-wh1000xm5',
    query: 'Sony WH-1000XM5',
    classify(title) {
      const t = title || '';
      if (!t) return { cls: 'ambiguous', why: 'empty title' };
      if (!/wh[-\s]?1000\s?xm5/i.test(t)) return { cls: 'mismatch', why: 'model token WH-1000XM5 absent' };
      if (/xm[234]\b/i.test(t)) return { cls: 'ambiguous', why: 'mentions another generation' };
      if (ACCESSORY_RE.test(t)) return { cls: 'mismatch', why: 'accessory keyword' };
      const v = conditionVariant(t);
      return v ? { cls: 'variant', variant: v, why: v } : { cls: 'match', variant: 'new' };
    },
  },
  {
    key: 'logitech-mx-master-3s',
    query: 'Logitech MX Master 3S',
    classify(title) {
      const t = title || '';
      if (!t) return { cls: 'ambiguous', why: 'empty title' };
      if (!/mx\s*master\s*3s/i.test(t)) return { cls: 'mismatch', why: 'model token MX Master 3S absent' };
      if (ACCESSORY_RE.test(t) && !/mouse$/i.test(t.trim())) return { cls: 'mismatch', why: 'accessory keyword' };
      const parts = [];
      if (/for\s+mac/i.test(t)) parts.push('for-mac');
      if (/business/i.test(t)) parts.push('business');
      const c = conditionVariant(t);
      if (c) parts.push(c);
      return parts.length ? { cls: 'variant', variant: parts.join('+'), why: parts.join('+') } : { cls: 'match', variant: 'new' };
    },
  },
  {
    key: 'samsung-990-pro-2tb',
    query: 'Samsung 990 PRO 2TB',
    classify(title) {
      const t = title || '';
      if (!t) return { cls: 'ambiguous', why: 'empty title' };
      if (!/990\s*pro/i.test(t)) return { cls: 'mismatch', why: 'model token 990 PRO absent' };
      const caps = new Set();
      for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb)\b/gi)) {
        const gb = m[2].toLowerCase() === 'tb' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
        caps.add(gb === 2000 ? '2TB' : `${m[1]}${m[2].toUpperCase()}`);
      }
      if (caps.size === 0) return { cls: 'ambiguous', why: 'capacity not stated' };
      if (caps.size > 1) return { cls: 'ambiguous', why: `multiple capacities: ${[...caps].join('/')}` };
      if (!caps.has('2TB')) return { cls: 'mismatch', why: `capacity ${[...caps][0]} is not 2TB` };
      if (ACCESSORY_RE.test(t)) return { cls: 'mismatch', why: 'accessory keyword' };
      const parts = [];
      if (/(w\/o|without)\s+heat\s?sink/i.test(t)) { /* plain drive */ }
      else if (/heat\s?sink/i.test(t)) parts.push('heatsink');
      if (/\bps5\b|playstation/i.test(t)) parts.push('ps5-marketing');
      const c = conditionVariant(t);
      if (c) parts.push(c);
      return parts.length ? { cls: 'variant', variant: parts.join('+'), why: parts.join('+') } : { cls: 'match', variant: 'new' };
    },
  },
];

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));
const rawPath = (name) => path.join(RAW, `${name}.json`);

function requireKey() {
  const k = process.env.PRICESAPI_KEY;
  if (!k) {
    console.error(
      '\nPRICESAPI_KEY is not set, so no network call was made.\n' +
      'Set it in YOUR terminal (never paste it into chat):\n' +
      '  read -s PRICESAPI_KEY && export PRICESAPI_KEY\n' +
      'then re-run this command in the same terminal. See README.md.\n'
    );
    process.exit(2);
  }
  return k;
}

// ---- credit ledger: enforces the budget across separate runs
function loadLedger() { return readJson(LEDGER, { budget: BUDGET, spent: 0, calls: [] }); }
function saveLedger(l) { writeJson(LEDGER, l); }
function logicalCount(l, ep) { return l.calls.filter((c) => c.endpoint === ep && !c.retry).length; }

// ---- one HTTP request. Retries at most once, and only for 429/503 (which are free responses).
async function api(endpoint, apiPath, params, label, { retry = true, isRetry = false } = {}) {
  const key = requireKey();
  const ledger = loadLedger();
  if (!isRetry) {
    if (CAPS[endpoint] !== undefined && logicalCount(ledger, endpoint) >= CAPS[endpoint])
      throw new Error(`cap reached: at most ${CAPS[endpoint]} ${endpoint} calls`);
  }
  const reserve = COST[endpoint];
  if (ledger.spent + reserve > ledger.budget)
    throw new Error(`budget guard: spent ${ledger.spent} + reserve ${reserve} > ${ledger.budget}`);

  const url = new URL(BASE + apiPath);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const t0 = Date.now();
  let res, body, text;
  try {
    // Authentication: the key travels in the Authorization header, never in the URL.
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
    text = await res.text();
    try { body = JSON.parse(text); } catch { body = { _nonJson: text.slice(0, 500) }; }
  } catch (e) {
    body = { _networkError: String(e.message || e) };
    res = { status: 0, headers: new Headers() };
  }
  const entry = { label, endpoint, path: apiPath, status: res.status, ms: Date.now() - t0, at: new Date().toISOString(), retry: isRetry, credits: 0 };
  ledger.calls.push(entry);

  // Settle actual credits according to the documented billing rules.
  if (res.status === 200) {
    if (endpoint === 'search') entry.credits = (body?.data?.products || []).some((p) => (p.offers || []).length) ? 10 : 0;
    else if (endpoint === 'snapshot') entry.credits = 1;
    else if (endpoint === 'history') entry.credits = body?.window?.days_with_offers ?? COST.history; // unknown -> assume worst case
  }
  ledger.spent += entry.credits;
  saveLedger(ledger);
  log(`  [${endpoint}] ${label} -> HTTP ${res.status} in ${entry.ms}ms, credits charged (est.): ${entry.credits}, total ${ledger.spent}/${ledger.budget}`);

  if ((res.status === 429 || res.status === 503) && retry) {
    const ra = Math.min(parseInt(res.headers.get('retry-after') || '30', 10) || 30, 65);
    log(`  rate limited/unavailable; waiting ${ra}s and retrying ONCE`);
    await sleep(ra * 1000);
    return api(endpoint, apiPath, params, label + ' (retry)', { retry: false, isRetry: true });
  }
  return { status: res.status, body, headers: res.headers };
}

// ---- save full response (gitignored) and a truncated sanitized copy (committable)
function truncate(v, depth = 0) {
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => truncate(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, truncate(x, depth + 1)]));
  if (typeof v === 'string' && v.startsWith('data:')) return v.slice(0, 30) + '...[data-uri trimmed]';
  return v;
}
function saveResponse(name, r) {
  writeJson(rawPath(name), { status: r.status, body: r.body });
  writeJson(path.join(EXAMPLES, `${name}.json`), { status: r.status, note: 'arrays truncated to first 3 items', body: truncate(r.body) });
}
const loadResponse = (name) => readJson(rawPath(name));

function normOffer(o, observedFallback) {
  let domain = o.seller_domain || null;
  if (!domain && o.url) { try { domain = new URL(o.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ } }
  return {
    seller: o.seller || null,
    domain,
    title: o.product_title || o.title || '',
    price: o.price === null || o.price === undefined ? null : Number(o.price),
    currency: o.currency || null,
    url: o.url || o.seller_product_url || null,
    observed_at: o.observed_at || observedFallback || null,
    stock: o.stock_status || o.availability || null,
    delivery: o.delivery_info ?? null,
  };
}

// ---------------------------------------------------------------- stages
async function stageCatalog(force) {
  log('\n== Catalog (free, 0 credits) ==');
  for (const p of PRODUCTS) {
    const name = `catalog-${p.key}`;
    if (loadResponse(name) && !force) { log(`  ${p.key}: cached, skipping`); continue; }
    const r = await api('catalog', '/products/catalog', { q: p.query, market: MARKET, limit: 5 }, p.key);
    saveResponse(name, r);
    if (r.status === 400) log('  400 body (may list supported markets):', JSON.stringify(r.body).slice(0, 400));
    await sleep(2200); // catalog is limited to 30/min; stay far below
  }
}

async function stageSearch(force) {
  log('\n== Search (10 credits each when offers are returned) ==');
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const name = `search-${p.key}`;
    if (loadResponse(name) && !force) { log(`  ${p.key}: cached (no new paid call)`); continue; }
    const r = await api('search', '/products/search', { q: p.query, market: MARKET, limit: 3, offers_limit: 60 }, p.key);
    saveResponse(name, r);
    if (i < PRODUCTS.length - 1) await sleep(11_000); // free plan: 6 searches/min
  }
}

function pickCandidate(p, searchBody) {
  const products = searchBody?.data?.products || [];
  const scored = products.map((c) => {
    const k = p.classify(c.title);
    const rank = k.cls === 'match' ? 2 : k.cls === 'variant' ? 1 : 0;
    return { c, rank, offers: (c.offers || []).length };
  }).sort((a, b) => b.rank - a.rank || b.offers - a.offers);
  return scored[0]?.rank > 0 ? scored[0].c : null;
}

function refOf(c) {
  if (c?.product_ref?.id) return { id: String(c.product_ref.id), id_type: c.product_ref.id_type || 'pricesapi', assumed: false };
  if (c?.pid !== undefined) return { id: String(c.pid), id_type: 'pricesapi', assumed: true }; // assumption: flagged in report
  return null;
}

async function stageSnapshot(force) {
  log('\n== Snapshot (1 credit each) ==');
  for (const p of PRODUCTS) {
    const s = loadResponse(`search-${p.key}`);
    const cand = s && s.status === 200 ? pickCandidate(p, s.body) : null;
    const ref = refOf(cand);
    if (!ref) { log(`  ${p.key}: no matching candidate from search; skipping`); continue; }
    const name = `snapshot-${p.key}`;
    if (loadResponse(name) && !force) { log(`  ${p.key}: cached`); continue; }
    const r = await api('snapshot', '/products', { id: ref.id, id_type: ref.id_type, market: MARKET, offers_limit: 60 }, p.key);
    saveResponse(name, r);
    await sleep(1200);
  }
}

function utcDay(d) { return d.toISOString().slice(0, 10); }

async function stageHistory(force) {
  log(`\n== History (max ${CAPS.history} products, ${HISTORY_DAYS}-day windows) ==`);
  // choose the 2 products with the most matched offers so far
  const ranked = PRODUCTS.map((p) => ({ p, a: analyzeProduct(p) })).filter((x) => x.a.ref).sort((a, b) => b.a.matched.length - a.a.matched.length).slice(0, CAPS.history);
  const to = new Date(Date.now() - 86400_000);            // yesterday (UTC): `to` may not be in the future
  const from = new Date(to.getTime() - (HISTORY_DAYS - 1) * 86400_000);
  for (const { p, a } of ranked) {
    const name = `history-${p.key}`;
    if (loadResponse(name) && !force) { log(`  ${p.key}: cached`); continue; }
    const params = { id: a.ref.id, id_type: a.ref.id_type, market: MARKET, from: utcDay(from), to: utcDay(to), limit: 1000 };
    let r = await api('history', '/products/history', params, p.key);
    const pages = [r];
    // following next_cursor is documented as free; follow at most 2 more pages
    for (let n = 0; n < 2 && pages[pages.length - 1].status === 200 && pages[pages.length - 1].body?.page?.next_cursor; n++) {
      const cur = pages[pages.length - 1].body.page.next_cursor;
      const more = await fetchHistoryPage(params, cur, p.key);
      pages.push(more);
      if (more.status !== 200) break;
    }
    const merged = JSON.parse(JSON.stringify(pages[0]));
    for (const extra of pages.slice(1)) if (extra.status === 200) merged.body.offers.push(...(extra.body.offers || []));
    saveResponse(name, merged);
    await sleep(1500);
  }
}

async function fetchHistoryPage(params, cursor, label) {
  // cursor pages are documented as free: not counted against the logical history cap, no ledger credit.
  const key = requireKey();
  const url = new URL(BASE + '/products/history');
  for (const [k, v] of Object.entries({ ...params, cursor })) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  const body = await res.json().catch(() => ({}));
  log(`  [history] ${label} cursor page -> HTTP ${res.status}`);
  return { status: res.status, body };
}

// ---------------------------------------------------------------- analysis
function analyzeProduct(p, source = 'search') {
  const search = loadResponse(`search-${p.key}`);
  const snap = loadResponse(`snapshot-${p.key}`);
  const cat = loadResponse(`catalog-${p.key}`);
  const out = { key: p.key, query: p.query, ref: null, candidates: [], source: null, offers: [], matched: [], variants: [], ambiguous: [], mismatched: [], notes: [] };
  if (!search || search.status !== 200) { out.notes.push(`search not available (status ${search?.status ?? 'not run'})`); return out; }
  for (const c of search.body?.data?.products || [])
    out.candidates.push({ title: c.title, pid: c.pid, product_ref: c.product_ref || null, offerCount: c.offerCount ?? (c.offers || []).length, catalog_id: c.catalog_id ?? null, classification: p.classify(c.title).cls });
  const cand = pickCandidate(p, search.body);
  out.ref = refOf(cand);
  if (out.ref?.assumed) out.notes.push('product_ref missing in search result; used pid with id_type=pricesapi (assumption)');
  const scraped = search.body?.meta?.scraped_at || null;
  out.searchMeta = { cache_source: search.body?.meta?.cache_source, cache_age_s: search.body?.meta?.cache_age_s, scraped_at: scraped, served_stale: search.body?.meta?.served_stale, degraded: search.body?.meta?.degraded, latency_ms: search.body?.meta?.latency_ms };

  let raw;
  const searchAge = search.body?.meta?.cache_age_s ?? 0; // live scrape (cache miss) => 0 s old at scrape time
  if (source === 'snapshot' && snap && snap.status === 200) {
    out.source = 'snapshot';
    raw = (snap.body.offers || []).map((o) => normOffer(o, snap.body?.observation?.observed_at));
    out.observation = snap.body.observation || null;
    out.productInfo = snap.body.product ? { title: snap.body.product.title, id: snap.body.product.id, catalog_id: snap.body.product.catalog_id } : null;
    out.offersPage = snap.body.offers_page || null;
  } else {
    out.source = 'search';
    const seen = new Set(); raw = [];
    for (const c of search.body?.data?.products || []) for (const o of c.offers || []) {
      const n = normOffer(o, scraped); n.candidate = c.title?.slice(0, 50); n.age_override = searchAge;
      const k = n.url || `${n.seller}|${n.price}|${n.title}`;
      if (!seen.has(k)) { seen.add(k); raw.push(n); }
    }
  }
  const now = Date.now();
  for (const o of raw) {
    const k = p.classify(o.title);
    o.cls = k.cls; o.variant = k.variant || null; o.why = k.why || null;
    o.age_s = o.age_override !== undefined ? o.age_override : o.observed_at ? Math.round((now - Date.parse(o.observed_at)) / 1000) : null;
    o.freshness = o.age_s === null || Number.isNaN(o.age_s) ? 'unknown' : o.age_s > STALE_AFTER_S ? 'stale' : 'fresh';
    const flags = [];
    if (!o.url) flags.push('no-url');
    if (o.price === null || !(o.price > 0)) flags.push('no-price');
    if (!o.currency) flags.push('no-currency');
    if (!o.observed_at) flags.push('no-timestamp');
    if (o.stock && /out|unavail|sold/i.test(o.stock)) flags.push('out-of-stock');
    if (o.freshness === 'stale') flags.push('stale');
    if (o.delivery === null) flags.push('no-delivery-info');
    o.flags = flags;
  }
  out.offers = raw;
  out.matched = raw.filter((o) => o.cls === 'match');
  out.variants = raw.filter((o) => o.cls === 'variant');
  out.ambiguous = raw.filter((o) => o.cls === 'ambiguous');
  out.mismatched = raw.filter((o) => o.cls === 'mismatch');

  // "verified comparable": exact match, usable price/currency/url, in stock, not stale
  const usable = out.matched.filter((o) => !o.flags.some((f) => ['no-url', 'no-price', 'no-currency', 'out-of-stock', 'stale'].includes(f)));
  const prices = usable.map((o) => o.price).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  out.verified = usable.map((o) => ({ ...o, outlier: median !== null && (o.price < median * 0.5 || o.price > median * 2) })); // outliers need manual review
  const nonOutlier = out.verified.filter((o) => !o.outlier).sort((a, b) => a.price - b.price);
  out.lowestVerified = nonOutlier[0] || null;
  out.distinctRetailersMatched = new Set(out.matched.map((o) => o.domain || o.seller)).size;
  out.distinctRetailersVerified = new Set(out.verified.map((o) => o.domain || o.seller)).size;
  out.currencies = [...new Set(raw.map((o) => o.currency).filter(Boolean))];
  out.missing = {
    delivery_info: raw.filter((o) => o.delivery === null).length,
    condition_in_data: 'no per-offer condition field in Snapshot; condition inferred from title keywords only',
    timestamps: raw.filter((o) => !o.observed_at).length,
    urls: raw.filter((o) => !o.url).length,
  };
  out.catalogRaw = cat ? { status: cat.status, sample: JSON.stringify(cat.body).slice(0, 600) } : null;

  const hist = loadResponse(`history-${p.key}`);
  if (hist && hist.status === 200) {
    const b = hist.body, days = {};
    for (const o of b.offers || []) { const d = (o.recorded_at || '').slice(0, 10); (days[d] ||= []).push(o); }
    const start = b.window?.from, end = b.window?.to, all = [];
    if (start && end) for (let t = Date.parse(start); t <= Date.parse(end); t += 86400_000) all.push(new Date(t).toISOString().slice(0, 10));
    out.history = {
      window: b.window, days_with_data: Object.keys(days).sort(),
      days_without_data: all.filter((d) => !days[d]),
      per_day: Object.fromEntries(Object.entries(days).sort().map(([d, os]) => [d, { observations: os.length, sellers: [...new Set(os.map((x) => x.seller_domain || x.seller))].length, min: Math.min(...os.map((x) => Number(x.price))), max: Math.max(...os.map((x) => Number(x.price))) }])),
      variant_mixed: b.product?.variant_mixed ?? null,
      title_class_counts: (b.offers || []).reduce((acc, o) => { const c = p.classify(o.product_title).cls; acc[c] = (acc[c] || 0) + 1; return acc; }, {}),
    };
  } else if (hist) out.history = { error: `status ${hist.status}`, body: hist.body };
  return out;
}

async function stageSpotcheck(force) {
  log('\n== Spot-check retailer pages (free; best-effort automated, one polite GET each) ==');
  const results = readJson(path.join(OUT, 'spotcheck.json'), {});
  for (const p of PRODUCTS) {
    const a = analyzeProduct(p);
    const seen = new Set();
    const picks = [...a.verified].sort((x, y) => x.price - y.price).filter((o) => { const d = o.domain || o.seller; if (seen.has(d)) return false; seen.add(d); return true; }).slice(0, 3);
    results[p.key] = results[p.key] || [];
    for (const o of picks) {
      if (results[p.key].some((r) => r.url === o.url) && !force) continue;
      let status = 'inconclusive', detail = '';
      try {
        const res = await fetch(o.url, { redirect: 'follow', headers: { 'User-Agent': 'dealproof-feasibility-experiment/0.1 (single GET, research)', Accept: 'text/html' }, signal: AbortSignal.timeout(15_000) });
        const html = await res.text();
        if ([401, 403, 429, 503].includes(res.status) || /captcha|are you a robot|access denied|verify you are human/i.test(html.slice(0, 20000))) { status = 'blocked'; detail = `HTTP ${res.status}`; }
        else if (res.status === 200) {
          const needle = o.price.toFixed(2);
          if (html.includes(needle) || html.includes(String(Math.round(o.price)) + '.')) { status = 'automated-price-found'; detail = `page contains ${needle}`; }
          else { status = 'inconclusive'; detail = 'page loaded but price string not found (may be JS-rendered or changed)'; }
        } else detail = `HTTP ${res.status}`;
      } catch (e) { status = 'inconclusive'; detail = `fetch error: ${e.message}`; }
      results[p.key].push({ seller: o.seller, domain: o.domain, url: o.url, listed_price: o.price, status, detail, at: new Date().toISOString() });
      log(`  ${p.key} ${o.domain}: ${status} (${detail})`);
      await sleep(3000);
    }
  }
  writeJson(path.join(OUT, 'spotcheck.json'), results);
}

function stageAnalyze() {
  log('\n== Analysis ==');
  const report = PRODUCTS.flatMap((p) => [analyzeProduct(p, 'search'), analyzeProduct(p, 'snapshot')]);
  const spot = readJson(path.join(OUT, 'spotcheck.json'), {});
  for (const r of report) r.spotcheck = spot[r.key] || [];
  writeJson(path.join(OUT, 'analysis.json'), report);
  for (const r of report) {
    log(`\n--- ${r.query} [${r.source}] ---`);
    if (!r.offers.length) { log('  no offers analysed:', r.notes.join('; ')); continue; }
    log(`  data source: ${r.source}; candidates: ${r.candidates.map((c) => `${c.title} [${c.classification}, ${c.offerCount} offers]`).join(' | ')}`);
    log(`  offers: ${r.offers.length} | matched ${r.matched.length} | variant ${r.variants.length} | ambiguous ${r.ambiguous.length} | mismatched ${r.mismatched.length}`);
    log(`  distinct retailers (matched): ${r.distinctRetailersMatched}; (verified comparable): ${r.distinctRetailersVerified}`);
    log(`  lowest verified comparable: ${r.lowestVerified ? `${r.lowestVerified.price} ${r.lowestVerified.currency} @ ${r.lowestVerified.domain} ${r.lowestVerified.url}` : 'none'}`);
    log(`  missing: ${JSON.stringify(r.missing)}`);
    if (r.history) log(`  history: ${r.history.error ? r.history.error : `${r.history.days_with_data.length} days with data, gaps: ${r.history.days_without_data.join(', ') || 'none'}`}`);
  }
  log('\nFull detail written to out/analysis.json (gitignored). Spend:', loadLedger().spent, '/', BUDGET);
}

function stageCheck() {
  const l = loadLedger();
  log('Key configured:', process.env.PRICESAPI_KEY ? 'yes' : 'NO (set PRICESAPI_KEY; see README.md)');
  log(`Budget: ${BUDGET} credits; spent so far: ${l.spent}`);
  log(`Worst case plan: search 3x10=30, snapshot 3x1=3, history 2 x <=${HISTORY_DAYS} = <=14  => <=47 credits`);
  log('Market:', MARKET, '| Base URL:', BASE);
}

// ---------------------------------------------------------------- main
const [stage = 'check', ...rest] = process.argv.slice(2);
const force = rest.includes('--force');
const stages = { check: stageCheck, catalog: stageCatalog, search: stageSearch, snapshot: stageSnapshot, history: stageHistory, spotcheck: stageSpotcheck, analyze: stageAnalyze };
try {
  if (stage === 'all') {
    requireKey();
    await stageCatalog(force); await stageSearch(force); await stageSnapshot(force); await stageHistory(force); await stageSpotcheck(force); stageAnalyze();
  } else if (stages[stage]) {
    if (!['check', 'analyze', 'spotcheck'].includes(stage)) requireKey();
    await stages[stage](force);
  } else { console.error('unknown stage', stage); process.exit(1); }
} catch (e) { console.error('ERROR:', e.message); process.exit(1); }
