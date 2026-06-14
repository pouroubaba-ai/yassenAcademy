'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { User, onAuthStateChanged, signInAnonymously, signOut } from 'firebase/auth'
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase'

export interface SecretarySession {
  id: string
  name: string
  email: string
  ownerId: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  secretary: SecretarySession | null
  loginAsSecretary: (email: string, code: string) => Promise<void>
  logoutSecretary: () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  secretary: null,
  loginAsSecretary: async () => {},
  logoutSecretary: () => {},
})

const SECRETARY_KEY = 'secretary_session'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [secretary, setSecretary] = useState<SecretarySession | null>(() => {
    if (typeof window === 'undefined') return null
    const raw = sessionStorage.getItem(SECRETARY_KEY)
    return raw ? JSON.parse(raw) : null
  })

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  async function loginAsSecretary(email: string, code: string) {
    const snap = await getDocs(
      query(collection(db, 'secretaries'), where('email', '==', email), where('isActive', '==', true))
    )
    if (snap.empty) throw new Error('Email ou code incorrect.')
    const matched = snap.docs.find((d) => d.data().code === code)
    if (!matched) throw new Error('Email ou code incorrect.')
    const data = matched.data()

    // Sign in anonymously so Firebase Auth is active → Firestore rules can validate reads
    const { user: anonUser } = await signInAnonymously(auth)

    // Register this anonymous session so Firestore rules can map it to the school owner
    await setDoc(doc(db, 'secretarySessions', anonUser.uid), {
      ownerId: data.ownerId,
      secretaryId: matched.id,
      createdAt: serverTimestamp(),
    })

    const session: SecretarySession = { id: matched.id, name: data.name, email: data.email, ownerId: data.ownerId }
    sessionStorage.setItem(SECRETARY_KEY, JSON.stringify(session))
    setSecretary(session)
  }

  function logoutSecretary() {
    if (auth.currentUser) {
      deleteDoc(doc(db, 'secretarySessions', auth.currentUser.uid)).catch(() => {})
      signOut(auth)
    }
    sessionStorage.removeItem(SECRETARY_KEY)
    setSecretary(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, secretary, loginAsSecretary, logoutSecretary }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
