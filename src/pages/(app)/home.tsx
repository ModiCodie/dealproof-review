/**
 * `/home` is the platform's default post-sign-in destination (see
 * src/server/http-routes.ts), so it must keep existing. DealProof's real front
 * page is the search page.
 */

import { Navigate } from 'react-router-dom'

export default function HomePage() {
  return <Navigate to="/search" replace />
}
