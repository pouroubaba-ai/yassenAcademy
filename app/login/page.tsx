'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from '../_lib/firebase'
import { useAuth } from '../_lib/auth-context'

type Tab = 'login' | 'register' | 'secretary'

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [secEmail, setSecEmail] = useState('')
  const [secCode, setSecCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { loginAsSecretary } = useAuth()

  function switchTab(t: Tab) { setTab(t); setError('') }

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (tab === 'register' && password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    try {
      if (tab === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
      router.replace('/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Une erreur est survenue.'
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Email ou mot de passe incorrect.')
      } else if (msg.includes('email-already-in-use')) {
        setError('Cet email est déjà utilisé.')
      } else if (msg.includes('weak-password')) {
        setError('Le mot de passe doit contenir au moins 6 caractères.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSecretarySubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await loginAsSecretary(secEmail, secCode)
      router.replace('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-[#00D1FF] mb-4 shadow-sm">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Yassen Academy</h1>
          <p className="text-slate-500 mt-1 text-sm">Système de gestion scolaire</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8">
          <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
            <button type="button" onClick={() => switchTab('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Se connecter
            </button>
            <button type="button" onClick={() => switchTab('register')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Créer un compte
            </button>
            <button type="button" onClick={() => switchTab('secretary')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'secretary' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Secrétaire
            </button>
          </div>

          {tab !== 'secretary' ? (
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Adresse email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@ecole.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] focus:border-transparent transition-all text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] focus:border-transparent transition-all text-sm" />
              </div>
              {tab === 'register' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmer le mot de passe</label>
                  <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] focus:border-transparent transition-all text-sm" />
                </div>
              )}
              {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
              <button type="submit" disabled={loading}
                className="w-full bg-[#00D1FF] text-white font-semibold py-2.5 rounded-xl shadow-sm hover:bg-[#00b8e0] transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm mt-2">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Chargement…
                  </span>
                ) : tab === 'login' ? 'Se connecter' : 'Créer mon compte'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSecretarySubmit} className="space-y-4">
              <p className="text-sm text-slate-500">Connectez-vous avec votre email et le code fourni par l'administrateur.</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Adresse email</label>
                <input type="email" required value={secEmail} onChange={(e) => setSecEmail(e.target.value)}
                  placeholder="secretaire@ecole.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] focus:border-transparent transition-all text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Code d'accès</label>
                <input type="password" required value={secCode} onChange={(e) => setSecCode(e.target.value)}
                  placeholder="••••"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] focus:border-transparent transition-all text-sm" />
              </div>
              {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
              <button type="submit" disabled={loading}
                className="w-full bg-[#00D1FF] text-white font-semibold py-2.5 rounded-xl shadow-sm hover:bg-[#00b8e0] transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm mt-2">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Chargement…
                  </span>
                ) : 'Accéder'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
