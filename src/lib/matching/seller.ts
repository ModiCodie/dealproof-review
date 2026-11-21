/**
 * Who is selling? Retailer domain, marketplace platform and named seller are
 * kept apart. "Sold through Walmart" is not "sold by Walmart".
 *
 * First-party ('yes') requires evidence. For retailers that also run a
 * marketplace (Walmart, Amazon, Newegg, Target, Best Buy) the retailer's name
 * alone is not enough.
 */

import type { NormalizedOffer } from '../pricing-types'
import type { PlatformKind, SellerIdentity } from './types'

interface PlatformInfo {
  name: string
  kind: PlatformKind
}

/** Hostname (without www) -> platform. Anything not listed is 'unknown' (an independent site). */
const PLATFORMS: Record<string, PlatformInfo> = {
  'bestbuy.com': { name: 'Best Buy', kind: 'hybrid' },
  'walmart.com': { name: 'Walmart', kind: 'hybrid' },
  'amazon.com': { name: 'Amazon', kind: 'hybrid' },
  'newegg.com': { name: 'Newegg', kind: 'hybrid' },
  'neweggbusiness.com': { name: 'Newegg Business', kind: 'hybrid' },
  'target.com': { name: 'Target', kind: 'hybrid' },
  'logitech.com': { name: 'Logitech', kind: 'retailer' },
  'samsung.com': { name: 'Samsung', kind: 'retailer' },
  'sony.com': { name: 'Sony', kind: 'retailer' },
  'electronics.sony.com': { name: 'Sony', kind: 'retailer' },
  'bhphotovideo.com': { name: 'B&H', kind: 'retailer' },
  'adorama.com': { name: 'Adorama', kind: 'retailer' },
  'cdw.com': { name: 'CDW', kind: 'retailer' },
  'staples.com': { name: 'Staples', kind: 'retailer' },
  'officedepot.com': { name: 'Office Depot', kind: 'retailer' },
  'lenovo.com': { name: 'Lenovo', kind: 'retailer' },
  'ebay.com': { name: 'eBay', kind: 'marketplace' },
  'mercari.com': { name: 'Mercari', kind: 'marketplace' },
  'poshmark.com': { name: 'Poshmark', kind: 'marketplace' },
  'reverb.com': { name: 'Reverb', kind: 'marketplace' },
  'swappa.com': { name: 'Swappa', kind: 'marketplace' },
  'backmarket.com': { name: 'Back Market', kind: 'marketplace' },
  'reebelo.com': { name: 'Reebelo', kind: 'marketplace' },
  'whatnot.com': { name: 'Whatnot', kind: 'marketplace' },
  'shop.tiktok.com': { name: 'TikTok Shop', kind: 'marketplace' },
  'alibaba.com': { name: 'Alibaba', kind: 'marketplace' },
  'etsy.com': { name: 'Etsy', kind: 'marketplace' },
  'doordash.com': { name: 'DoorDash', kind: 'delivery' },
  'ubereats.com': { name: 'Uber Eats', kind: 'delivery' },
  'instacart.com': { name: 'Instacart', kind: 'delivery' },
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function platformFor(host: string | null): PlatformInfo | null {
  if (!host) return null
  if (PLATFORMS[host]) return PLATFORMS[host]
  // subdomains of a known platform, e.g. m.ebay.com
  for (const [d, p] of Object.entries(PLATFORMS)) if (host.endsWith('.' + d)) return p
  return null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function identifySeller(offer: NormalizedOffer): SellerIdentity {
  const raw = offer.seller
  const domain = hostOf(offer.listingUrl) ?? hostOf(offer.sellerUrl)
  const info = platformFor(domain)

  // The feed formats marketplace sellers as "<Platform> - <seller>".
  let head = raw
  let sellerName: string | null = null
  if (raw) {
    const i = raw.indexOf(' - ')
    if (i > 0) {
      head = raw.slice(0, i).trim()
      sellerName = raw.slice(i + 3).trim() || null
    }
  }

  const base = { raw, domain, sellerName }

  if (!raw && !domain) {
    return { ...base, platform: null, platformKind: 'unknown', firstParty: 'unknown', evidence: 'No seller information in the feed' }
  }

  if (!info) {
    // An independent site we don't know. Its name tells us nothing about who sells.
    return {
      ...base,
      platform: head,
      platformKind: 'unknown',
      firstParty: 'unknown',
      evidence: 'Independent or unrecognised website; seller type not established',
    }
  }

  const nameMatchesPlatform = head ? norm(head).includes(norm(info.name)) || norm(info.name).includes(norm(head)) : false

  switch (info.kind) {
    case 'marketplace':
      return {
        ...base,
        platform: info.name,
        platformKind: 'marketplace',
        firstParty: 'no',
        evidence: sellerName
          ? `${info.name} is a marketplace; sold by third-party seller "${sellerName}"`
          : `${info.name} is a marketplace; the individual seller is not identified`,
      }
    case 'delivery':
      return {
        ...base,
        platform: info.name,
        platformKind: 'delivery',
        firstParty: 'no',
        evidence: `${info.name} is a delivery service reselling from a store${sellerName ? ` ("${sellerName}")` : ''}`,
      }
    case 'retailer': {
      if (sellerName) {
        return { ...base, platform: info.name, platformKind: 'retailer', firstParty: 'no', evidence: `Seller named as "${sellerName}", not ${info.name} itself` }
      }
      return nameMatchesPlatform
        ? { ...base, platform: info.name, platformKind: 'retailer', firstParty: 'yes', evidence: `Seller name matches the ${info.name} site; no third-party seller named` }
        : { ...base, platform: info.name, platformKind: 'retailer', firstParty: 'unknown', evidence: 'Seller name does not match the site' }
    }
    case 'hybrid': {
      if (sellerName) {
        return { ...base, platform: info.name, platformKind: 'hybrid', firstParty: 'no', evidence: `Sold through ${info.name} by third-party seller "${sellerName}"` }
      }
      if (!nameMatchesPlatform) {
        return { ...base, platform: info.name, platformKind: 'hybrid', firstParty: 'unknown', evidence: 'Seller name does not match the site' }
      }
      // Walmart marks its own listings with selectedSellerId=0 in the listing URL.
      // That convention was observed in the Day 1 data; it is not documented by Walmart.
      if (info.name === 'Walmart' && offer.listingUrl) {
        try {
          const id = new URL(offer.listingUrl).searchParams.get('selectedSellerId')
          if (id === '0') {
            return { ...base, platform: info.name, platformKind: 'hybrid', firstParty: 'yes', evidence: 'Walmart listing URL has selectedSellerId=0 (observed convention for Walmart itself; not documented)' }
          }
          if (id) {
            return { ...base, platform: info.name, platformKind: 'hybrid', firstParty: 'no', evidence: 'Walmart listing URL names a different seller id' }
          }
        } catch {
          /* fall through */
        }
      }
      return {
        ...base,
        platform: info.name,
        platformKind: 'hybrid',
        firstParty: 'unknown',
        evidence: `${info.name} also hosts third-party sellers; the feed does not say who sells this`,
      }
    }
    default:
      return { ...base, platform: info.name, platformKind: 'unknown', firstParty: 'unknown', evidence: 'Seller type not established' }
  }
}

/**
 * Stable identity used to decide whether two offers come from the same seller.
 * Returns null when the seller cannot be identified (e.g. a marketplace listing
 * with no seller name, where many different people could be selling).
 */
export function sellerKey(s: SellerIdentity): string | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (s.platformKind === 'marketplace' || s.platformKind === 'delivery') {
    return s.sellerName && s.platform ? `${norm(s.platform)}|${norm(s.sellerName)}` : null
  }
  if (s.sellerName && s.platform) return `${norm(s.platform)}|${norm(s.sellerName)}`
  const base = s.domain ?? (s.raw ? norm(s.raw) : null)
  return base || null
}
