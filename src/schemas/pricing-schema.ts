/**
 * Server-only collections for the price search feature.
 *
 * Both are denied to every role (including admin) from the browser: only server
 * actions touch them (actions run with RBAC off, so the permission blocks below
 * do not affect them). That keeps cache contents and usage counters out of
 * reach of any client, and a user cannot edit their own quota.
 */

import type { CollectionSchema } from 'deepspace/schema'

const denyAll = { read: false, create: false, update: false, delete: false } as const

/** One row per (market, normalized query): the normalized Search result. */
export const searchCacheSchema: CollectionSchema = {
  name: 'search_cache',
  columns: [
    { name: 'key', storage: 'text', interpretation: { kind: 'plain' }, required: true, maxLength: 200 },
    { name: 'market', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 8 },
    { name: 'query', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 200 },
    // Normalized candidates + source metadata (auto stringified/parsed).
    { name: 'payload', storage: 'text', interpretation: { kind: 'json' } },
    // When we stored it / when our cache entry expires (epoch ms).
    { name: 'cachedAtMs', storage: 'number', interpretation: { kind: 'plain' } },
    { name: 'expiresAtMs', storage: 'number', interpretation: { kind: 'plain' } },
  ],
  uniqueOn: ['key'],
  permissions: { '*': denyAll, viewer: denyAll, member: denyAll, admin: denyAll },
}

/**
 * Atomic "claims". A claim is a row whose `claimKey` is unique: creating a
 * duplicate is refused inside the single Durable Object that stores records,
 * so two concurrent requests can never both win the same slot. Used for
 * per-user daily slots, global daily slots, and in-flight search locks.
 */
export const usageClaimsSchema: CollectionSchema = {
  name: 'usage_claims',
  columns: [
    { name: 'claimKey', storage: 'text', interpretation: { kind: 'plain' }, required: true, maxLength: 300 },
    { name: 'kind', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 16 }, // user | global | lock
    { name: 'userId', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 128 },
    { name: 'day', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 10 }, // UTC YYYY-MM-DD
    { name: 'createdAtMs', storage: 'number', interpretation: { kind: 'plain' } },
  ],
  uniqueOn: ['claimKey'],
  permissions: { '*': denyAll, viewer: denyAll, member: denyAll, admin: denyAll },
}
