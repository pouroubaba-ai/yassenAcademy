'use client'

import { useState } from 'react'
import { collection, addDoc, updateDoc, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../_lib/firebase'

interface Props {
  uid: string
  onClose: () => void
}

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export default function CreateSchoolYearModal({ uid, onClose }: Props) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const [startMonth, setStartMonth] = useState(currentMonth)
  const [startDay, setStartDay] = useState(1)
  const [endMonth, setEndMonth] = useState(6)
  const [endDay, setEndDay] = useState(30)
  const [endYear, setEndYear] = useState(currentYear + 1)
  const [monthlyFee, setMonthlyFee] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const fee = parseFloat(monthlyFee)
    if (!fee || fee <= 0) {
      setError('Les frais de scolarité doivent être supérieurs à zéro.')
      return
    }

    setLoading(true)
    onClose()
    try {
      // Désactiver les années existantes de cet utilisateur uniquement
      const snap = await getDocs(query(collection(db, 'schoolYears'), where('userId', '==', uid)))
      await Promise.all(
        snap.docs.map((d) => updateDoc(doc(db, 'schoolYears', d.id), { isActive: false }))
      )

      const newYear = await addDoc(collection(db, 'schoolYears'), {
        startDay,
        startMonth,
        startYear: currentYear,
        endDay,
        endMonth,
        endYear,
        monthlyFee: fee,
        isActive: true,
        userId: uid,
        createdAt: new Date().toISOString(),
      })

      await addDoc(collection(db, 'fees'), {
        name: 'Scolarité',
        monthlyAmount: fee,
        isDefault: true,
        schoolYearId: newYear.id,
        userId: uid,
      })
    } catch {
      setError('Erreur lors de la création. Veuillez réessayer.')
    } finally {
      setLoading(false)
    }
  }

  const daysInMonth = (m: number, y: number) => new Date(y, m, 0).getDate()

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-slate-900">Nouvelle année scolaire</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Date de début <span className="text-slate-400 font-normal">(année {currentYear})</span>
            </label>
            <div className="flex gap-2">
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(Number(e.target.value))}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1} disabled={i + 1 < currentMonth}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={startDay}
                onChange={(e) => setStartDay(Number(e.target.value))}
                className="w-24 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              >
                {Array.from({ length: daysInMonth(startMonth, currentYear) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Date de fin</label>
            <div className="flex gap-2">
              <select
                value={endMonth}
                onChange={(e) => setEndMonth(Number(e.target.value))}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                value={endDay}
                onChange={(e) => setEndDay(Number(e.target.value))}
                className="w-24 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              >
                {Array.from({ length: daysInMonth(endMonth, endYear) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                className="w-28 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              >
                {[currentYear, currentYear + 1, currentYear + 2].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Frais de scolarité mensuelle
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-2.5 pr-12 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">MAD</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors disabled:opacity-60"
            >
              {loading ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
