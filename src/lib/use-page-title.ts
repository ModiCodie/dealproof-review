import { useEffect } from 'react'
import { BRAND_NAME } from '@/constants'

/** Sets the browser tab title for the current page ("Compare · DealProof"). */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · ${BRAND_NAME}` : BRAND_NAME
    return () => {
      document.title = previous
    }
  }, [title])
}
