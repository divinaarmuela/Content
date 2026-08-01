"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = (props: ToasterProps) => (
  <Sonner
    position="bottom-right"
    toastOptions={{
      style: {
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        color: 'hsl(var(--card-foreground))',
        borderRadius: 10,
        fontSize: 13,
        fontFamily: 'inherit',
        boxShadow: '0 4px 12px rgba(0,0,0,0.10), 0 12px 32px -8px rgba(0,0,0,0.14)',
      },
    }}
    {...props}
  />
)

export { Toaster }
