/**
 * Saved products: one small row per (user, product, variant).
 *
 * Security is enforced by the record Durable Object, not by the UI:
 *   - `userId` is `userBound`: the DO overwrites it with the caller's verified id
 *     on every write, so a client cannot create a row for someone else.
 *   - `ownerField: 'userId'` + `'own'` permissions: a member can read and delete
 *     only their own rows. Admins get no extra read access (a shopping list is
 *     private even from the app owner).
 *   - `uniqueOn: ['userId', 'productKey']`: a second save of the same product and
 *     variant is refused by the DO, even against a forged or replayed client write.
 *   - every column is `immutable` and members cannot update, so a saved row can
 *     only be created or removed. Changing the variant means saving another row.
 * No price data lives here; comparisons are read from the server-only search_cache.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const savedProductsSchema: CollectionSchema = {
  name: 'saved_products',
  columns: [
    { name: 'userId', storage: 'text', interpretation: { kind: 'plain' }, required: true, userBound: true, immutable: true, maxLength: 128 },
    { name: 'productKey', storage: 'text', interpretation: { kind: 'plain' }, required: true, immutable: true, maxLength: 200 },
    { name: 'family', storage: 'text', interpretation: { kind: 'plain' }, required: true, immutable: true, maxLength: 64 },
    { name: 'variant', storage: 'text', interpretation: { kind: 'json' }, immutable: true },
    { name: 'displayName', storage: 'text', interpretation: { kind: 'plain' }, required: true, immutable: true, maxLength: 200 },
    { name: 'query', storage: 'text', interpretation: { kind: 'plain' }, required: true, immutable: true, maxLength: 200 },
    { name: 'market', storage: 'text', interpretation: { kind: 'plain' }, immutable: true, maxLength: 8 },
  ],
  uniqueOn: ['userId', 'productKey'],
  ownerField: 'userId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: false, delete: 'own' },
    admin: { read: 'own', create: true, update: false, delete: 'own' },
  },
}

/**
 * The last successfully captured prices for one saved generic product.
 *
 * Server-only, like `search_cache`: denied to every role from the browser, so no
 * client can read, forge or edit a snapshot. Only the server actions
 * `captureSavedSnapshot` / `discardSavedSnapshot` touch it, after checking that the
 * verified caller owns the saved record. The contents are copied by the server from
 * its own price cache (never from the browser), cover only the one saved product
 * group, and are deleted when the saved record is removed. See docs/general-search.md.
 */
export const savedSnapshotsSchema: CollectionSchema = {
  name: 'saved_snapshots',
  columns: [
    { name: 'savedId', storage: 'text', interpretation: { kind: 'plain' }, required: true, maxLength: 128 },
    { name: 'userId', storage: 'text', interpretation: { kind: 'plain' }, required: true, maxLength: 128 },
    { name: 'query', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 200 },
    // { candidate, offers, source, truncated } (auto stringified/parsed)
    { name: 'payload', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'capturedAtMs', storage: 'number', interpretation: { kind: 'plain' } },
  ],
  uniqueOn: ['savedId'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
