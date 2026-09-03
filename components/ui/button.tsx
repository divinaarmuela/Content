'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Every button is a 44px pill. 44px was already the floor for a fingertip;
 * the new look uses that one height for every control on the page, so the old
 * mouse-density sizes (36px, 32px) are gone and `size` only changes how wide
 * the pill is. A call site that truly needs something smaller says so in its
 * own `className`, which still wins.
 *
 * `default` is the ink pill — the one action a page is FOR. `outline` is the
 * white surface pill beside it. Inside an ink card the primary flips to cream
 * so it stays visible against its host.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-foreground text-background hover:bg-foreground/90 [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink',
        destructive:
          'bg-accent-red text-cream hover:bg-accent-red/90',
        outline:
          'border border-border bg-surface text-foreground hover:bg-foreground/[0.04]',
        secondary:
          'bg-paper text-foreground hover:bg-foreground/[0.08]',
        ghost: 'text-foreground hover:bg-foreground/[0.06]',
        link: 'text-accent-blue-deep underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-11 px-4',
        lg: 'h-11 px-6',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
