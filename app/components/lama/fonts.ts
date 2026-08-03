import { Archivo, Sometype_Mono } from 'next/font/google'

export const archivo = Archivo({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-archivo',
  display: 'swap',
})

export const sometype = Sometype_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sometype',
  display: 'swap',
})
