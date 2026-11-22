import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { runSearch } from '../server/pricing/search'
import { getSavedComparison } from '../server/saved/comparison'
import { captureSavedSnapshot, discardSavedSnapshot } from '../server/saved/snapshot'

/**
 * Server actions, callable from the browser as `POST /api/actions/<name>`.
 *
 * The route (src/server/action-routes.ts) verifies the caller's JWT first, so
 * every action below already runs for a signed-in user, and `userId` is the
 * verified identity. Never read a user id from `params`.
 */
export const actions: Record<string, ActionHandler<Env>> = {
  /** Search retailer offers for a product name. See src/server/pricing/search.ts. */
  searchProducts: async ({ userId, params, tools, env }) => {
    return runSearch(params?.query, {
      tools,
      userId,
      apiKey: env.PRICESAPI_KEY,
      configEnv: env,
    })
  },

  /**
   * Reopen a saved product with the data already stored. Never calls the price
   * API and never uses quota; ownership is checked against the verified userId.
   */
  getSavedComparison: async ({ userId, params, tools, env }) => {
    return getSavedComparison(params?.savedId, { tools, userId, configEnv: env })
  },

  /**
   * Store the last successfully captured prices for a saved general product, copied from the
   * server's own cache. Owner-only; never calls the price API; never uses quota; writes nothing
   * if the saved product group cannot be confirmed in the stored data.
   */
  captureSavedSnapshot: async ({ userId, params, tools }) => {
    return captureSavedSnapshot(params?.savedId, { tools, userId })
  },

  /** Delete the snapshot of a saved product that was removed. Owner-only. */
  discardSavedSnapshot: async ({ userId, params, tools }) => {
    return discardSavedSnapshot(params?.savedId, { tools, userId })
  },
}
