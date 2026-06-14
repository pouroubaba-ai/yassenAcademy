'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { SchoolYear } from './types'
import { useAuth } from './auth-context'

interface SchoolYearContextType {
  activeYear: SchoolYear | null
  allYears: SchoolYear[]
  loading: boolean
  uid: string | null
}

const SchoolYearContext = createContext<SchoolYearContextType>({
  activeYear: null,
  allYears: [],
  loading: true,
  uid: null,
})

export function SchoolYearProvider({ children }: { children: React.ReactNode }) {
  const { user, secretary } = useAuth()
  // Secretary's ownerId must take priority over the anonymous Firebase uid
  const effectiveUid = secretary?.ownerId ?? user?.uid ?? null
  const [activeYear, setActiveYear] = useState<SchoolYear | null>(null)
  const [allYears, setAllYears] = useState<SchoolYear[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!effectiveUid) {
      setLoading(false)
      return
    }
    const q = query(
      collection(db, 'schoolYears'),
      where('userId', '==', effectiveUid),
    )
    const unsub = onSnapshot(q, (snap) => {
      const years = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as SchoolYear))
        .sort((a, b) => b.startYear - a.startYear)
      setAllYears(years)
      setActiveYear(years.find((y) => y.isActive) ?? null)
      setLoading(false)
    })
    return unsub
  }, [effectiveUid])

  return (
    <SchoolYearContext.Provider value={{ activeYear, allYears, loading, uid: effectiveUid }}>
      {children}
    </SchoolYearContext.Provider>
  )
}

export function useSchoolYear() {
  return useContext(SchoolYearContext)
}
