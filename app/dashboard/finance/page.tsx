'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { useCurrency } from '../../_lib/currency-context'
import { Student, SchoolClass, Family, Fee, MonthlyEntry, MonthlyEntryFee } from '../../_lib/types'
import { MONTHS_FR, getSchoolYearMonths, monthLabel, resolveEntry } from '../../_lib/finance-utils'
import { generateMissingMonths } from '../../_lib/monthly-generator'

// Dynamically resolve the real fees for an entry, merging stored entry.fees with
// the student's current appliedFees. This ensures reduction changes and newly added
// fees are always reflected without needing to update every monthlyEntry document.
function resolveEntryFees(
  entry: MonthlyEntry,
  student: Student | undefined,
  allFees: Fee[],
): { feeId: string; feeName: string; amount: number; reduction: number; due: number; paid: number; balance: number }[] {
  const entryFeeMap = new Map(entry.fees.map((ef) => [ef.feeId, ef]))
  const appliedMap = new Map((student?.appliedFees ?? []).map((af) => [af.feeId, af]))
  const allFeeIds = new Set([...entryFeeMap.keys(), ...appliedMap.keys()])
  const result: { feeId: string; feeName: string; amount: number; reduction: number; due: number; paid: number; balance: number }[] = []
  for (const fid of allFeeIds) {
    const ef = entryFeeMap.get(fid)
    const af = appliedMap.get(fid)
    const gf = allFees.find((f) => f.id === fid)
    let feeName: string, amount: number, paid: number, reduction: number
    if (ef) {
      feeName = ef.feeName
      amount = ef.amount
      paid = ef.paid
      // Always use the student's CURRENT reduction from appliedFees if available
      reduction = af !== undefined ? af.reduction : (ef.reduction ?? 0)
    } else if (af && gf) {
      // Fee added after entry was generated — treat as unpaid with current month amount
      feeName = gf.name
      amount = gf.monthlyAmount
      paid = 0
      reduction = af.reduction
    } else continue
    const due = Math.max(0, amount - reduction)
    const balance = Math.max(0, due - paid)
    result.push({ feeId: fid, feeName, amount, reduction, due, paid, balance })
  }
  return result
}

type ViewMode = 'mensuelle' | 'annuelle'
type DataView = 'eleves' | 'familles'
type ActiveFilter = 'actifs' | 'tous'

export default function FinancePage() {
  const { activeYear, allYears, uid } = useSchoolYear()
  const { fmt, symbol } = useCurrency()
  const [selectedYearId, setSelectedYearId] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('mensuelle')
  const [dataView, setDataView] = useState<DataView>('eleves')
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1)
  const [filterActive, setFilterActive] = useState<ActiveFilter>('actifs')
  const [filterPayment, setFilterPayment] = useState<'' | 'impaye' | 'partiel' | 'paye'>('')
  const [filterClassId, setFilterClassId] = useState('')
  const [search, setSearch] = useState('')
  const [tooltipKey, setTooltipKey] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // Reduction edit state
  const [editStudentId, setEditStudentId] = useState<string | null>(null)
  const [editFamilyId, setEditFamilyId] = useState<string | null>(null)

  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [families, setFamilies] = useState<Family[]>([])
  const [fees, setFees] = useState<Fee[]>([])
  const [entries, setEntries] = useState<MonthlyEntry[]>([])

  const year = allYears.find((y) => y.id === (selectedYearId || activeYear?.id)) ?? activeYear
  const yearId = year?.id ?? ''

  useEffect(() => {
    if (!yearId || !uid) return
    const u1 = onSnapshot(query(collection(db, 'students'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setStudents(s.docs.map((d) => ({ id: d.id, ...d.data() } as Student))))
    const u2 = onSnapshot(query(collection(db, 'classes'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setClasses(s.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolClass))))
    const u3 = onSnapshot(query(collection(db, 'families'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setFamilies(s.docs.map((d) => ({ id: d.id, ...d.data() } as Family))))
    const u4 = onSnapshot(query(collection(db, 'fees'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setFees(s.docs.map((d) => ({ id: d.id, ...d.data() } as Fee))))
    const u5 = onSnapshot(query(collection(db, 'monthlyEntries'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setEntries(s.docs.map((d) => ({ id: d.id, ...d.data() } as MonthlyEntry))))
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [yearId, uid])

  useEffect(() => {
    if (!year || !uid || students.length === 0 || fees.length === 0) return
    setGenerating(true)
    generateMissingMonths(year, students, fees, db, uid).finally(() => setGenerating(false))
  }, [year?.id, uid, students.length, fees.length])

  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]))
  const familyMap = Object.fromEntries(families.map((f) => [f.id, f.name]))
  const yearMonths = year ? getSchoolYearMonths(year) : []

  const scopedEntries = useMemo(() => {
    if (viewMode === 'annuelle') return entries
    return entries.filter((e) => e.month === selectedMonth)
  }, [entries, viewMode, selectedMonth])

  const studentAgg = useMemo(() => {
    const map: Record<string, {
      totalDue: number; totalPaid: number; totalBalance: number; totalReductions: number
      byFee: Record<string, { feeName: string; due: number; paid: number; balance: number; reduction: number }>
    }> = {}
    for (const entry of scopedEntries) {
      if (!map[entry.studentId]) {
        map[entry.studentId] = { totalDue: 0, totalPaid: 0, totalBalance: 0, totalReductions: 0, byFee: {} }
      }
      const agg = map[entry.studentId]
      const student = students.find((s) => s.id === entry.studentId)
      // Resolve fees dynamically: combines stored paid amounts with current appliedFees
      // so that new fees and reduction changes are always reflected in real time
      const resolved = resolveEntryFees(entry, student, fees)
      for (const rf of resolved) {
        agg.totalDue += rf.due
        agg.totalPaid += rf.paid
        agg.totalBalance += rf.balance
        agg.totalReductions += rf.reduction
        if (!agg.byFee[rf.feeId]) agg.byFee[rf.feeId] = { feeName: rf.feeName, due: 0, paid: 0, balance: 0, reduction: 0 }
        agg.byFee[rf.feeId].due += rf.due
        agg.byFee[rf.feeId].paid += rf.paid
        agg.byFee[rf.feeId].balance += rf.balance
        agg.byFee[rf.feeId].reduction += rf.reduction
      }
    }
    return map
  }, [scopedEntries, students, fees])

  const filteredStudents = useMemo(() => {
    let list = students.filter((s) => studentAgg[s.id])
    if (filterActive === 'actifs') list = list.filter((s) => s.isActive)
    if (filterPayment) {
      list = list.filter((s) => {
        const agg = studentAgg[s.id]
        if (!agg) return false
        if (filterPayment === 'paye') return agg.totalBalance === 0 && agg.totalPaid > 0
        if (filterPayment === 'impaye') return agg.totalPaid === 0 && agg.totalBalance > 0
        if (filterPayment === 'partiel') return agg.totalPaid > 0 && agg.totalBalance > 0
        return true
      })
    }
    if (filterClassId) list = list.filter((s) => s.classId === filterClassId)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q))
    }
    return list
  }, [students, studentAgg, filterActive, filterPayment, filterClassId, search])

  const filteredFamilies = useMemo(() => {
    let list = families
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((f) => f.name.toLowerCase().includes(q))
    }
    return list.map((fam) => {
      const memberStudents = students.filter((s) => s.familyId === fam.id)
      let totalDue = 0, totalPaid = 0, totalBalance = 0, totalReductions = 0
      const byFee: Record<string, { feeName: string; due: number; paid: number; balance: number; reduction: number }> = {}
      for (const s of memberStudents) {
        const agg = studentAgg[s.id]
        if (!agg) continue
        totalDue += agg.totalDue
        totalPaid += agg.totalPaid
        totalBalance += agg.totalBalance
        totalReductions += agg.totalReductions
        for (const [fid, fa] of Object.entries(agg.byFee)) {
          if (!byFee[fid]) byFee[fid] = { feeName: fa.feeName, due: 0, paid: 0, balance: 0, reduction: 0 }
          byFee[fid].due += fa.due
          byFee[fid].paid += fa.paid
          byFee[fid].balance += fa.balance
          byFee[fid].reduction += fa.reduction
        }
      }
      return { family: fam, totalDue, totalPaid, totalBalance, totalReductions, byFee, memberCount: memberStudents.length }
    }).filter((f) => f.totalDue > 0)
  }, [families, students, search, studentAgg])

  const stats = useMemo(() => {
    const list = dataView === 'eleves'
      ? filteredStudents.map((s) => studentAgg[s.id]).filter(Boolean)
      : filteredFamilies
    const totalDue = list.reduce((s, a) => s + a.totalDue, 0)
    const totalPaid = list.reduce((s, a) => s + a.totalPaid, 0)
    const totalBalance = list.reduce((s, a) => s + a.totalBalance, 0)
    return { totalDue, totalPaid, totalBalance }
  }, [dataView, filteredStudents, filteredFamilies, studentAgg])

  const debtCount = filteredStudents.filter((s) => (studentAgg[s.id]?.totalBalance ?? 0) > 0).length
  const paidCount = filteredStudents.filter((s) => (studentAgg[s.id]?.totalBalance ?? 0) === 0 && (studentAgg[s.id]?.totalDue ?? 0) > 0).length

  function toggleTooltip(key: string) {
    setTooltipKey((prev) => (prev === key ? null : key))
  }

  // Get entries for student on selected month
  const editStudentEntries = useMemo(() => {
    if (!editStudentId) return []
    return scopedEntries.filter((e) => e.studentId === editStudentId)
  }, [editStudentId, scopedEntries])

  // Get entries for family on selected month
  const editFamilyEntries = useMemo(() => {
    if (!editFamilyId) return []
    const memberIds = students.filter((s) => s.familyId === editFamilyId).map((s) => s.id)
    return scopedEntries.filter((e) => memberIds.includes(e.studentId))
  }, [editFamilyId, scopedEntries, students])

  if (!year) {
    return <div className="p-8"><p className="text-slate-500 text-sm">Aucune année scolaire active.</p></div>
  }

  return (
    <div className="p-8" onClick={() => setTooltipKey(null)}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Suivi Financier</h1>
          <p className="text-slate-500 text-sm mt-1">
            Prévisions et encaissements
            {generating && <span className="ml-2 text-[#00D1FF]">— Génération en cours…</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]">
            <option value="">Année en cours</option>
            {allYears.map((y) => <option key={y.id} value={y.id}>{y.startYear}/{y.endYear}</option>)}
          </select>
          <Link href="/dashboard/finance/versements"
            className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors">
            Enregistrer un versement
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total attendu" value={fmt(stats.totalDue)} sub={`${filteredStudents.length} élève(s)`} color="slate" />
        <StatCard label="Total encaissé" value={fmt(stats.totalPaid)} sub={`${paidCount} à jour`} color="emerald" />
        <StatCard label="Reste à verser" value={fmt(stats.totalBalance)} sub={`${debtCount} en retard`} color="red" />
        <StatCard
          label="Taux recouvrement"
          value={stats.totalDue > 0 ? `${Math.round((stats.totalPaid / stats.totalDue) * 100)} %` : '—'}
          sub="sur la sélection" color="cyan" />
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex rounded-xl bg-slate-100 p-0.5">
          {(['mensuelle', 'annuelle'] as ViewMode[]).map((v) => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all capitalize ${viewMode === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {v === 'mensuelle' ? 'Mensuelle' : 'Annuelle'}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl bg-slate-100 p-0.5">
          {(['eleves', 'familles'] as DataView[]).map((v) => (
            <button key={v} onClick={() => setDataView(v)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dataView === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {v === 'eleves' ? 'Élèves' : 'Familles'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {viewMode === 'mensuelle' && (
          <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]">
            {yearMonths.map(({ month, year: y }) => (
              <option key={`${y}-${month}`} value={month}>{MONTHS_FR[month - 1]} {y}</option>
            ))}
          </select>
        )}

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={dataView === 'eleves' ? 'Rechercher un élève…' : 'Rechercher une famille…'}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
            onClick={(e) => e.stopPropagation()} />
        </div>

        {dataView === 'eleves' && (
          <>
            <button onClick={() => setFilterActive(filterActive === 'actifs' ? 'tous' : 'actifs')}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${filterActive === 'actifs' ? 'bg-[#00D1FF]/10 border-[#00D1FF]/30 text-[#00D1FF]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {filterActive === 'actifs' ? 'Actifs' : 'Tous'}
            </button>
            <div className="flex rounded-xl bg-slate-100 p-0.5 gap-0.5">
              {([
                ['', 'Tous'],
                ['impaye', 'Impayé'],
                ['partiel', 'Partiel'],
                ['paye', 'Payé'],
              ] as [string, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setFilterPayment(val as '' | 'impaye' | 'partiel' | 'paye')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                    filterPayment === val
                      ? val === 'impaye' ? 'bg-white text-red-600 shadow-sm'
                        : val === 'partiel' ? 'bg-white text-amber-600 shadow-sm'
                        : val === 'paye' ? 'bg-white text-emerald-600 shadow-sm'
                        : 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <select value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)}
              className={`px-3 py-2.5 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#00D1FF] ${filterClassId ? 'border-[#00D1FF]/30 bg-[#00D1FF]/5 text-[#00D1FF]' : 'border-slate-200 text-slate-600'}`}>
              <option value="">Toutes les classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {(filterPayment || filterClassId) && (
              <button onClick={() => { setFilterPayment(''); setFilterClassId('') }}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Réinitialiser
              </button>
            )}
          </>
        )}
      </div>

      {/* Table — Élèves */}
      {dataView === 'eleves' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Élève</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Classe</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Famille</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Dû</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Versé</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Réductions</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Reste</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-400 text-sm">
                    Aucun élève trouvé pour cette période.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student) => {
                  const agg = studentAgg[student.id]
                  if (!agg) return null
                  const isLate = agg.totalBalance > 0
                  return (
                    <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${student.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                            {student.firstName[0]}{student.lastName[0]}
                          </div>
                          <Link href={`/dashboard/eleves/${student.id}`} className="font-medium text-slate-900 hover:text-[#00D1FF]">
                            {student.firstName} {student.lastName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 text-sm">{classMap[student.classId] || '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{student.familyId ? familyMap[student.familyId] || '—' : '—'}</td>
                      <AmountCell value={agg.totalDue} byFee={agg.byFee} symbol={symbol} tooltipKey={tooltipKey} cellKey={`${student.id}-due`} onToggle={toggleTooltip} fmt={fmt} />
                      <AmountCell value={agg.totalPaid} byFee={agg.byFee} symbol={symbol} tooltipKey={tooltipKey} cellKey={`${student.id}-paid`} onToggle={toggleTooltip} fmt={fmt} field="paid" />
                      {/* Réductions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-semibold text-sm text-amber-600">{fmt(agg.totalReductions)}</span>
                          {viewMode === 'mensuelle' && editStudentEntries && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditStudentId(student.id) }}
                              className="text-slate-300 hover:text-[#00D1FF] transition-colors"
                              title="Modifier les réductions"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                      <AmountCell value={agg.totalBalance} byFee={agg.byFee} symbol={symbol} tooltipKey={tooltipKey} cellKey={`${student.id}-balance`} onToggle={toggleTooltip} fmt={fmt} field="balance" highlight={isLate} />
                      <td className="px-5 py-3.5 text-center">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${student.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          {student.isActive ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Table — Familles */}
      {dataView === 'familles' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Famille</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Enfants</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Dû</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Versé</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Réductions</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Reste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredFamilies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400 text-sm">
                    Aucune famille trouvée pour cette période.
                  </td>
                </tr>
              ) : (
                filteredFamilies.map(({ family, totalDue, totalPaid, totalBalance, byFee, memberCount, totalReductions }) => (
                  <tr key={family.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link href={`/dashboard/eleves/famille/${family.id}`} className="font-medium text-slate-900 hover:text-[#00D1FF]">
                        {family.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{memberCount}</td>
                    <AmountCell value={totalDue} byFee={byFee} symbol={symbol} tooltipKey={tooltipKey} cellKey={`fam-${family.id}-due`} onToggle={toggleTooltip} fmt={fmt} />
                    <AmountCell value={totalPaid} byFee={byFee} symbol={symbol} tooltipKey={tooltipKey} cellKey={`fam-${family.id}-paid`} onToggle={toggleTooltip} fmt={fmt} field="paid" />
                    {/* Réductions */}
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-semibold text-sm text-amber-600">{fmt(totalReductions)}</span>
                        {viewMode === 'mensuelle' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditFamilyId(family.id) }}
                            className="text-slate-300 hover:text-[#00D1FF] transition-colors"
                            title="Modifier les réductions"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                    <AmountCell value={totalBalance} byFee={byFee} symbol={symbol} tooltipKey={tooltipKey} cellKey={`fam-${family.id}-balance`} onToggle={toggleTooltip} fmt={fmt} field="balance" highlight={totalBalance > 0} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Reduction Modals */}
      {editStudentId && (
        <EditReductionModal
          title={(() => { const s = students.find((st) => st.id === editStudentId); return s ? `${s.firstName} ${s.lastName}` : '' })()}
          subtitle={monthLabel(selectedMonth, year.startYear)}
          entries={editStudentEntries}
          student={students.find((s) => s.id === editStudentId)}
          allFees={fees}
          fmt={fmt}
          symbol={symbol}
          onClose={() => setEditStudentId(null)}
        />
      )}
      {editFamilyId && (
        <FamilyReductionModal
          family={families.find((f) => f.id === editFamilyId)!}
          entries={editFamilyEntries}
          students={students.filter((s) => s.familyId === editFamilyId)}
          allFees={fees}
          fmt={fmt}
          symbol={symbol}
          monthLabel={monthLabel(selectedMonth, year.startYear)}
          onClose={() => setEditFamilyId(null)}
        />
      )}
    </div>
  )
}

// ─── Edit Reduction Modal (student) ───────────────────────────────────────────
function EditReductionModal({
  title, subtitle, entries, student, allFees, fmt, symbol, onClose,
}: {
  title: string
  subtitle: string
  entries: MonthlyEntry[]
  student: Student | undefined
  allFees: Fee[]
  fmt: (n: number) => string
  symbol: string
  onClose: () => void
}) {
  // Resolve fees dynamically: includes new fees + current reductions
  const resolvedEntries = entries.map((e) => resolveEntry(e, student, allFees))

  const [values, setValues] = useState<Record<string, Record<string, string>>>(() => {
    const v: Record<string, Record<string, string>> = {}
    for (const re of resolvedEntries) {
      v[re.id] = {}
      for (const rf of re.fees) v[re.id][rf.feeId] = String(rf.reduction)
    }
    return v
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function getMax(rf: MonthlyEntryFee) {
    return Math.max(0, rf.amount - rf.paid)
  }

  function validate(): string | null {
    for (const re of resolvedEntries) {
      for (const rf of re.fees) {
        const val = parseFloat(values[re.id]?.[rf.feeId] ?? String(rf.reduction))
        if (isNaN(val) || val < 0) return `Réduction invalide pour ${rf.feeName}`
        if (val > getMax(rf)) return `Réduction trop élevée pour ${rf.feeName} (max ${fmt(getMax(rf))})`
      }
    }
    return null
  }

  async function save() {
    const err = validate()
    if (err) { setError(err); return }
    if (!student) { onClose(); return }
    setSaving(true)
    try {
      // Collect feeId → new reduction from all modal inputs
      const feeReductionMap: Record<string, number> = {}
      for (const re of resolvedEntries) {
        for (const rf of re.fees) {
          const v = parseFloat(values[re.id]?.[rf.feeId] ?? String(rf.reduction))
          if (!isNaN(v)) feeReductionMap[rf.feeId] = v
        }
      }

      // 1. Update student.appliedFees — source of truth for resolveEntry
      const existingIds = new Set(student.appliedFees.map((af) => af.feeId))
      const newAppliedFees = [
        ...student.appliedFees.map((af) =>
          feeReductionMap[af.feeId] !== undefined ? { ...af, reduction: feeReductionMap[af.feeId] } : af
        ),
        ...Object.entries(feeReductionMap)
          .filter(([fid]) => !existingIds.has(fid))
          .map(([fid, red]) => ({ feeId: fid, reduction: red })),
      ]
      await updateDoc(doc(db, 'students', student.id), { appliedFees: newAppliedFees })

      // 2. Materialize resolved fees into each entry doc (keeps stored data consistent)
      for (const re of resolvedEntries) {
        const updatedFees = re.fees.map((rf) => {
          const r = feeReductionMap[rf.feeId] !== undefined ? feeReductionMap[rf.feeId] : rf.reduction
          const newDue = Math.max(0, rf.amount - r)
          const newBalance = Math.max(0, newDue - rf.paid)
          return { ...rf, reduction: r, due: newDue, balance: newBalance }
        })
        const totalDue = updatedFees.reduce((s, ef) => s + ef.due, 0)
        const totalBalance = updatedFees.reduce((s, ef) => s + ef.balance, 0)
        await updateDoc(doc(db, 'monthlyEntries', re.id), { fees: updatedFees, totalDue, totalBalance })
      }
      onClose()
    } catch {
      setError('Erreur lors de la sauvegarde.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Modifier les réductions</h2>
            <p className="text-xs text-slate-500 mt-0.5">{title} — {subtitle}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {resolvedEntries.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">Aucune entrée pour ce mois.</p>
          ) : (
            resolvedEntries.map((entry) => (
              <div key={entry.id} className="mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Frais</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Montant</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Versé</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Réduction</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Dette</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {entry.fees.map((rf) => {
                      const rawVal = values[entry.id]?.[rf.feeId] ?? String(rf.reduction)
                      const numVal = parseFloat(rawVal)
                      const maxR = getMax(rf)
                      const newDue = isNaN(numVal) ? rf.due : Math.max(0, rf.amount - numVal)
                      const newBalance = isNaN(numVal) ? rf.balance : Math.max(0, newDue - rf.paid)
                      const isOver = !isNaN(numVal) && numVal > maxR
                      return (
                        <tr key={rf.feeId} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 text-slate-700">{rf.feeName}</td>
                          <td className="px-3 py-2.5 text-right text-slate-600">{fmt(rf.amount)}</td>
                          <td className="px-3 py-2.5 text-right text-emerald-600">{fmt(rf.paid)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number" min="0" max={maxR} step="1"
                                value={rawVal}
                                onChange={(e) => setValues((prev) => ({
                                  ...prev,
                                  [entry.id]: { ...prev[entry.id], [rf.feeId]: e.target.value }
                                }))}
                                className={`w-24 px-2 py-1 rounded-lg border text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] ${isOver ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-900'}`}
                              />
                              <span className="text-slate-400 text-xs">{symbol}</span>
                            </div>
                            <p className="text-xs text-slate-400 text-right mt-0.5">max {fmt(maxR)}</p>
                          </td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${newBalance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                            {fmt(newBalance)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
          {error && <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-3">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
            Annuler
          </button>
          <button onClick={save} disabled={saving || resolvedEntries.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] disabled:opacity-50 transition-colors">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Family Reduction Modal ────────────────────────────────────────────────────
function FamilyReductionModal({
  family, entries, students, allFees, fmt, symbol, monthLabel: mLabel, onClose,
}: {
  family: Family
  entries: MonthlyEntry[]
  students: Student[]
  allFees: Fee[]
  fmt: (n: number) => string
  symbol: string
  monthLabel: string
  onClose: () => void
}) {
  // Resolve each entry against its student
  const resolvedEntries = entries.map((e) => {
    const student = students.find((s) => s.id === e.studentId)
    return resolveEntry(e, student, allFees)
  })

  const [values, setValues] = useState<Record<string, Record<string, string>>>(() => {
    const v: Record<string, Record<string, string>> = {}
    for (const re of resolvedEntries) {
      v[re.id] = {}
      for (const rf of re.fees) v[re.id][rf.feeId] = String(rf.reduction)
    }
    return v
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function getMax(rf: MonthlyEntryFee) {
    return Math.max(0, rf.amount - rf.paid)
  }

  function validate(): string | null {
    for (const re of resolvedEntries) {
      for (const rf of re.fees) {
        const val = parseFloat(values[re.id]?.[rf.feeId] ?? String(rf.reduction))
        if (isNaN(val) || val < 0) return `Réduction invalide pour ${rf.feeName}`
        if (val > getMax(rf)) return `Réduction trop élevée pour ${rf.feeName} (max ${fmt(getMax(rf))})`
      }
    }
    return null
  }

  async function save() {
    const err = validate()
    if (err) { setError(err); return }
    setSaving(true)
    try {
      // Group resolved entries by student
      const byStudent: Record<string, typeof resolvedEntries> = {}
      for (const re of resolvedEntries) {
        if (!byStudent[re.studentId]) byStudent[re.studentId] = []
        byStudent[re.studentId].push(re)
      }

      for (const [studentId, studentEntries] of Object.entries(byStudent)) {
        const student = students.find((s) => s.id === studentId)
        if (!student) continue

        // Collect new reductions for this student's fees
        const feeReductionMap: Record<string, number> = {}
        for (const re of studentEntries) {
          for (const rf of re.fees) {
            const v = parseFloat(values[re.id]?.[rf.feeId] ?? String(rf.reduction))
            if (!isNaN(v)) feeReductionMap[rf.feeId] = v
          }
        }

        // 1. Update student.appliedFees
        const existingIds = new Set(student.appliedFees.map((af) => af.feeId))
        const newAppliedFees = [
          ...student.appliedFees.map((af) =>
            feeReductionMap[af.feeId] !== undefined ? { ...af, reduction: feeReductionMap[af.feeId] } : af
          ),
          ...Object.entries(feeReductionMap)
            .filter(([fid]) => !existingIds.has(fid))
            .map(([fid, red]) => ({ feeId: fid, reduction: red })),
        ]
        await updateDoc(doc(db, 'students', studentId), { appliedFees: newAppliedFees })

        // 2. Materialize into each entry doc
        for (const re of studentEntries) {
          const updatedFees = re.fees.map((rf) => {
            const r = feeReductionMap[rf.feeId] !== undefined ? feeReductionMap[rf.feeId] : rf.reduction
            const newDue = Math.max(0, rf.amount - r)
            const newBalance = Math.max(0, newDue - rf.paid)
            return { ...rf, reduction: r, due: newDue, balance: newBalance }
          })
          const totalDue = updatedFees.reduce((s, ef) => s + ef.due, 0)
          const totalBalance = updatedFees.reduce((s, ef) => s + ef.balance, 0)
          await updateDoc(doc(db, 'monthlyEntries', re.id), { fees: updatedFees, totalDue, totalBalance })
        }
      }
      onClose()
    } catch {
      setError('Erreur lors de la sauvegarde.')
      setSaving(false)
    }
  }

  const studentMap = Object.fromEntries(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`]))

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Modifier les réductions</h2>
            <p className="text-xs text-slate-500 mt-0.5">{family.name} — {mLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {resolvedEntries.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">Aucune entrée pour ce mois.</p>
          ) : (
            resolvedEntries.map((entry) => {
              const studentName = studentMap[entry.studentId] || '—'
              return (
                <div key={entry.id}>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">{studentName}</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Frais</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Montant</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Versé</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Réduction</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Dette</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {entry.fees.map((rf) => {
                        const rawVal = values[entry.id]?.[rf.feeId] ?? String(rf.reduction)
                        const numVal = parseFloat(rawVal)
                        const maxR = getMax(rf)
                        const newDue = isNaN(numVal) ? rf.due : Math.max(0, rf.amount - numVal)
                        const newBalance = isNaN(numVal) ? rf.balance : Math.max(0, newDue - rf.paid)
                        const isOver = !isNaN(numVal) && numVal > maxR
                        return (
                          <tr key={rf.feeId} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 text-slate-700">{rf.feeName}</td>
                            <td className="px-3 py-2.5 text-right text-slate-600">{fmt(rf.amount)}</td>
                            <td className="px-3 py-2.5 text-right text-emerald-600">{fmt(rf.paid)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number" min="0" max={maxR} step="1"
                                  value={rawVal}
                                  onChange={(e) => setValues((prev) => ({
                                    ...prev,
                                    [entry.id]: { ...prev[entry.id], [rf.feeId]: e.target.value }
                                  }))}
                                  className={`w-24 px-2 py-1 rounded-lg border text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] ${isOver ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-900'}`}
                                />
                                <span className="text-slate-400 text-xs">{symbol}</span>
                              </div>
                              <p className="text-xs text-slate-400 text-right mt-0.5">max {fmt(maxR)}</p>
                            </td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${newBalance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                              {fmt(newBalance)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}
          {error && <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
            Annuler
          </button>
          <button onClick={save} disabled={saving || resolvedEntries.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] disabled:opacity-50 transition-colors">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared components ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: 'slate' | 'emerald' | 'red' | 'cyan' }) {
  const colors = { slate: 'text-slate-900', emerald: 'text-emerald-600', red: 'text-red-500', cyan: 'text-[#00D1FF]' }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${colors[color]}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function AmountCell({
  value, byFee, symbol, tooltipKey, cellKey, onToggle, fmt, field = 'due', highlight = false,
}: {
  value: number
  byFee: Record<string, { feeName: string; due: number; paid: number; balance: number; reduction?: number }>
  symbol: string
  tooltipKey: string | null
  cellKey: string
  onToggle: (k: string) => void
  fmt: (n: number) => string
  field?: 'due' | 'paid' | 'balance'
  highlight?: boolean
}) {
  const open = tooltipKey === cellKey
  return (
    <td className="px-5 py-3.5 text-right relative">
      <div className="flex items-center justify-end gap-1.5">
        <span className={`font-semibold text-sm ${highlight ? 'text-red-500' : 'text-slate-900'}`}>{fmt(value)}</span>
        <button onClick={(e) => { e.stopPropagation(); onToggle(cellKey) }}
          className="text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-200 p-3 z-30 min-w-[200px] text-left"
          onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Détail par frais</p>
          {Object.entries(byFee).map(([feeId, row]) => (
            <div key={feeId} className="flex items-center justify-between gap-4 py-1 border-b border-slate-50 last:border-0">
              <span className="text-xs text-slate-700">{row.feeName}</span>
              <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">{fmt(row[field])}</span>
            </div>
          ))}
        </div>
      )}
    </td>
  )
}
