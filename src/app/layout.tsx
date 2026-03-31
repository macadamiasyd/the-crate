import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Crate',
  description: 'Vinyl record listening log and collection manager',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
