import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from './_lib/auth-context'
import { SchoolYearProvider } from './_lib/school-year-context'
import { CurrencyProvider } from './_lib/currency-context'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Yassen Academy',
  description: 'Application de gestion scolaire',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.className}>
      <body className="min-h-screen bg-slate-50">
        <AuthProvider>
          <CurrencyProvider>
            <SchoolYearProvider>{children}</SchoolYearProvider>
          </CurrencyProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
