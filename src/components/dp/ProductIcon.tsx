import { Headphones, HardDrive, Mouse } from 'lucide-react'
import type { FamilyId } from '@/lib/matching'
import { cn } from '@/lib/utils'

const ICONS = {
  'sony-wh-1000xm5': Headphones,
  'logitech-mx-master-3s': Mouse,
  'samsung-990-pro': HardDrive,
} as const

/** A tinted tile with the product category's icon (no product photos: none are licensed for use here). */
export function ProductIcon({ family, className }: { family: FamilyId; className?: string }) {
  const Icon = ICONS[family]
  return (
    <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary', className)} aria-hidden>
      <Icon className="size-5" />
    </span>
  )
}
