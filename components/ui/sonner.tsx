"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="light"
    position="bottom-right"
    toastOptions={{
      style: {
        background: '#fff',
        border: '1px solid #e8e7ef',
        color: '#1f1b2e',
        borderRadius: 10,
        fontSize: 13,
        fontFamily: 'inherit',
      },
    }}
    {...props}
  />
)

export { Toaster }
