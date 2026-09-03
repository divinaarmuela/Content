import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-1.5 text-chip-12 transition-colors focus:outline-none focus:ring-2 focus:ring-ring',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-foreground text-background [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink',
        secondary:
          'border-transparent bg-foreground/[0.06] text-foreground',
        destructive:
          'border-transparent bg-tint-red text-foreground',
        outline: 'border-border bg-surface text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
