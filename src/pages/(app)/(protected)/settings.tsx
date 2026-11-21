/**
 * Account page, reached from the account menu at /settings. No auth logic lives
 * here because (protected)/_layout.tsx already wraps the subtree in <AuthGate>.
 */

import { signOut, useUser } from 'deepspace'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui'
import { Page } from '@/components/dp/ui'
import { usePageTitle } from '@/lib/use-page-title'

export default function SettingsPage() {
  usePageTitle('Account')
  const { user } = useUser()

  return (
    <Page className="max-w-2xl">
      <h1 className="text-3xl font-semibold text-foreground">Account</h1>
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-foreground">Your details</h2>
        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="mt-0.5 text-foreground">{user?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="mt-0.5 text-foreground">{user?.email ?? '—'}</dd>
          </div>
        </dl>
        <Button variant="outline" className="mt-6" onClick={() => signOut()}>
          <LogOut aria-hidden />
          Sign out
        </Button>
      </section>
    </Page>
  )
}
