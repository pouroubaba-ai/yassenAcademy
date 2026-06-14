'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth-context'

export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  MAD: { symbol: 'MAD', label: 'Dirham marocain (MAD)' },
  XOF: { symbol: 'FCFA', label: 'Franc CFA Ouest (FCFA)' },
  XAF: { symbol: 'FCFA', label: 'Franc CFA Central (FCFA)' },
  EUR: { symbol: '€', label: 'Euro (€)' },
  USD: { symbol: '$', label: 'Dollar américain ($)' },
}

interface CurrencyCtx {
  currency: string
  symbol: string
  fmt: (n: number) => string
}

const CurrencyContext = createContext<CurrencyCtx>({
  currency: 'MAD',
  symbol: 'MAD',
  fmt: (n) => `${n.toLocaleString('fr-FR')} MAD`,
})

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const { user, secretary } = useAuth()
  const [currency, setCurrency] = useState('MAD')

  const effectiveUid = secretary?.ownerId ?? user?.uid ?? null

  useEffect(() => {
    if (!effectiveUid) return
    return onSnapshot(doc(db, 'settings', effectiveUid), (snap) => {
      if (snap.exists()) setCurrency(snap.data().currency || 'MAD')
    })
  }, [effectiveUid])

  const symbol = CURRENCIES[currency]?.symbol ?? currency

  function fmt(n: number) {
    const formatted = n.toLocaleString('fr-FR')
    return currency === 'EUR' ? `${formatted} €` : `${formatted} ${symbol}`
  }

  return (
    <CurrencyContext.Provider value={{ currency, symbol, fmt }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
