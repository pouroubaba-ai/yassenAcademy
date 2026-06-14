'use client'

import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../_lib/firebase'
import { useSchoolYear } from '../_lib/school-year-context'
import { useCurrency } from '../_lib/currency-context'
import CreateSchoolYearModal from './_components/CreateSchoolYearModal'

const MONTHS = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
  'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc',
]

export default function DashboardPage() {
  const { activeYear, loading, uid } = useSchoolYear()
  const { fmt } = useCurrency()
  const [showModal, setShowModal] = useState(false)

  const [studentCount, setStudentCount] = useState<number | null>(null)
  const [classCount, setClassCount] = useState<number | null>(null)
  const [familyCount, setFamilyCount] = useState<number | null>(null)

  useEffect(() => {
    if (!activeYear?.id || !uid) return
    const yearId = activeYear.id

    const u1 = onSnapshot(
      query(collection(db, 'students'), where('schoolYearId', '==', yearId), where('userId', '==', uid), where('isActive', '==', true)),
      (s) => setStudentCount(s.size)
    )
    const u2 = onSnapshot(
      query(collection(db, 'classes'), where('schoolYearId', '==', yearId), where('userId', '==', uid)),
      (s) => setClassCount(s.size)
    )
    const u3 = onSnapshot(
      query(collection(db, 'families'), where('schoolYearId', '==', yearId), where('userId', '==', uid)),
      (s) => setFamilyCount(s.size)
    )
    return () => { u1(); u2(); u3() }
  }, [activeYear?.id, uid])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Tableau de bord</h1>
        <p className="text-slate-500 text-sm mt-1">Vue d'ensemble de votre établissement</p>
      </div>

      {!activeYear && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center max-w-md mx-auto">
          <div className="w-14 h-14 rounded-xl bg-[#00D1FF]/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#00D1FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Aucune année scolaire active</h2>
          <p className="text-slate-500 text-sm mb-6">
            Créez une année scolaire pour commencer à gérer votre établissement.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#00D1FF] text-white px-6 py-2.5 rounded-xl font-semibold text-sm shadow-sm hover:bg-[#00b8e0] transition-colors"
          >
            Créer une nouvelle année scolaire
          </button>
        </div>
      )}

      {activeYear && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Active year card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 col-span-full">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Année scolaire en cours</p>
                <p className="text-xl font-bold text-slate-900">
                  {MONTHS[activeYear.startMonth - 1]} {activeYear.startYear} — {MONTHS[activeYear.endMonth - 1]} {activeYear.endYear}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 text-xs font-semibold px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Active
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              Frais de scolarité : <span className="font-semibold text-slate-900">{fmt(activeYear.monthlyFee)} / mois</span>
            </p>
          </div>

          <StatCard
            label="Élèves actifs"
            value={studentCount !== null ? String(studentCount) : '…'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <StatCard
            label="Classes"
            value={classCount !== null ? String(classCount) : '…'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
          />
          <StatCard
            label="Familles"
            value={familyCount !== null ? String(familyCount) : '…'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            }
          />
        </div>
      )}

      {showModal && uid && <CreateSchoolYearModal uid={uid} onClose={() => setShowModal(false)} />}
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <span className="text-[#00D1FF]">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}
