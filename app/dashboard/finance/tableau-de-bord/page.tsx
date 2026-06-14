'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { useCurrency } from '../../../_lib/currency-context'
import { Student, SchoolClass, Family, Fee, MonthlyEntry } from '../../../_lib/types'
import { MONTHS_FR, getSchoolYearMonths } from '../../../_lib/finance-utils'

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
      feeName = ef.feeName; amount = ef.amount; paid = ef.paid
      reduction = af !== undefined ? af.reduction : (ef.reduction ?? 0)
    } else if (af && gf) {
      feeName = gf.name; amount = gf.monthlyAmount; paid = 0; reduction = af.reduction
    } else continue
    const due = Math.max(0, amount - reduction)
    const balance = Math.max(0, due - paid)
    result.push({ feeId: fid, feeName, amount, reduction, due, paid, balance })
  }
  return result
}

// Returns 'past' | 'current' | 'future' for a given month/year
function getMonthStatus(month: number, year: number): 'past' | 'current' | 'future' {
  const now = new Date()
  const nm = now.getMonth() + 1
  const ny = now.getFullYear()
  if (year < ny || (year === ny && month < nm)) return 'past'
  if (year === ny && month === nm) return 'current'
  return 'future'
}

export default function TableauDeBordFinancePage() {
  const { activeYear, allYears, uid } = useSchoolYear()
  const { fmt } = useCurrency()
  const [selectedYearId, setSelectedYearId] = useState('')
  // filterMonth = 0 means "all"; otherwise month number; filterYear for disambiguation
  const [filterMonth, setFilterMonth] = useState<number>(0)
  const [filterYear, setFilterYear] = useState<number>(0)
  const [showAllStudents, setShowAllStudents] = useState(false)
  const [showAllFamilies, setShowAllFamilies] = useState(false)

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

  // Reset month filter when year changes
  useEffect(() => { setFilterMonth(0); setFilterYear(0) }, [yearId])

  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]))
  const yearMonths = year ? getSchoolYearMonths(year) : []

  // Resolve all entries dynamically (correct totals accounting for appliedFees changes)
  const resolvedEntries = useMemo(() => {
    return entries.map((entry) => {
      const student = students.find((s) => s.id === entry.studentId)
      const resolved = resolveEntryFees(entry, student, fees)
      const totalDue = resolved.reduce((s, r) => s + r.due, 0)
      const totalPaid = resolved.reduce((s, r) => s + r.paid, 0)
      const totalBalance = resolved.reduce((s, r) => s + r.balance, 0)
      const totalReductions = resolved.reduce((s, r) => s + r.reduction, 0)
      return { ...entry, totalDue, totalPaid, totalBalance, totalReductions, resolvedFees: resolved }
    })
  }, [entries, students, fees])

  // Filtered entries — filter by both month AND year to avoid collision across school years
  const filteredEntries = useMemo(() =>
    filterMonth === 0
      ? resolvedEntries
      : resolvedEntries.filter((e) => e.month === filterMonth && (filterYear === 0 || e.year === filterYear)),
  [resolvedEntries, filterMonth, filterYear])

  // KPIs
  const kpis = useMemo(() => {
    const totalDue = filteredEntries.reduce((s, e) => s + e.totalDue, 0)
    const totalPaid = filteredEntries.reduce((s, e) => s + e.totalPaid, 0)
    const totalBalance = filteredEntries.reduce((s, e) => s + e.totalBalance, 0)
    const totalReductions = filteredEntries.reduce((s, e) => s + e.totalReductions, 0)
    const rate = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0

    const debtByStudent: Record<string, number> = {}
    for (const e of filteredEntries) {
      debtByStudent[e.studentId] = (debtByStudent[e.studentId] ?? 0) + e.totalBalance
    }
    const upToDate = Object.values(debtByStudent).filter((d) => d === 0).length
    const late = Object.values(debtByStudent).filter((d) => d > 0).length

    return { totalDue, totalPaid, totalBalance, totalReductions, rate, upToDate, late }
  }, [filteredEntries])

  // Top student debtors
  const allStudentDebtors = useMemo(() => {
    const byStudent: Record<string, number> = {}
    for (const e of filteredEntries) byStudent[e.studentId] = (byStudent[e.studentId] ?? 0) + e.totalBalance
    return Object.entries(byStudent)
      .filter(([, debt]) => debt > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([sid, debt]) => {
        const student = students.find((s) => s.id === sid)
        if (!student) return null
        const family = student.familyId ? families.find((f) => f.id === student.familyId) : null
        return { student, family, debt }
      })
      .filter(Boolean) as { student: Student; family: Family | null; debt: number }[]
  }, [filteredEntries, students, families])

  // Top family debtors
  const allFamilyDebtors = useMemo(() => {
    return families
      .map((fam) => {
        const memberIds = students.filter((s) => s.familyId === fam.id).map((s) => s.id)
        const debt = filteredEntries
          .filter((e) => memberIds.includes(e.studentId))
          .reduce((s, e) => s + e.totalBalance, 0)
        return { family: fam, debt }
      })
      .filter((f) => f.debt > 0)
      .sort((a, b) => b.debt - a.debt)
  }, [families, students, filteredEntries])

  // Class breakdown
  const classBreakdown = useMemo(() => {
    return classes
      .map((cls) => {
        const classStudentIds = students.filter((s) => s.classId === cls.id).map((s) => s.id)
        const classEntries = filteredEntries.filter((e) => classStudentIds.includes(e.studentId))
        const due = classEntries.reduce((s, e) => s + e.totalDue, 0)
        const paid = classEntries.reduce((s, e) => s + e.totalPaid, 0)
        const rate = due > 0 ? Math.round((paid / due) * 100) : 0
        return { cls, due, paid, rate, balance: due - paid }
      })
      .filter((c) => c.due > 0)
      .sort((a, b) => b.balance - a.balance)
  }, [classes, students, filteredEntries])

  // Fee breakdown
  const feeBreakdown = useMemo(() => {
    const map: Record<string, { feeName: string; due: number; paid: number; balance: number; reductions: number }> = {}
    for (const entry of filteredEntries) {
      for (const rf of entry.resolvedFees) {
        if (!map[rf.feeId]) map[rf.feeId] = { feeName: rf.feeName, due: 0, paid: 0, balance: 0, reductions: 0 }
        map[rf.feeId].due += rf.due
        map[rf.feeId].paid += rf.paid
        map[rf.feeId].balance += rf.balance
        map[rf.feeId].reductions += rf.reduction
      }
    }
    return Object.values(map).filter((f) => f.due > 0).sort((a, b) => b.due - a.due)
  }, [filteredEntries])

  // Monthly evolution (all months of the year)
  const monthlyEvolution = useMemo(() => {
    if (!year) return []
    const months = getSchoolYearMonths(year)
    return months.map(({ month, year: y }) => {
      const monthEntries = resolvedEntries.filter((e) => e.month === month && e.year === y)
      return {
        label: `${MONTHS_FR[month - 1].slice(0, 3)} ${y}`,
        due: monthEntries.reduce((s, e) => s + e.totalDue, 0),
        paid: monthEntries.reduce((s, e) => s + e.totalPaid, 0),
        balance: monthEntries.reduce((s, e) => s + e.totalBalance, 0),
      }
    })
  }, [resolvedEntries, year])

  const maxMonthly = Math.max(...monthlyEvolution.map((m) => m.due), 1)

  // Future months that already have at least one payment — key = "year-month"
  const futureMonthsWithPayments = useMemo(() => {
    const keys = new Set<string>()
    for (const e of resolvedEntries) {
      if (getMonthStatus(e.month, e.year) === 'future' && e.totalPaid > 0) {
        keys.add(`${e.year}-${e.month}`)
      }
    }
    return keys
  }, [resolvedEntries])

  if (!year) return <div className="p-8"><p className="text-slate-500 text-sm">Aucune année scolaire active.</p></div>

  // Selected month status for the banner
  const selectedStatus = filterMonth === 0 ? null : getMonthStatus(filterMonth, filterYear)
  const selectedMonthLabel = filterMonth === 0 ? null
    : `${MONTHS_FR[filterMonth - 1]} ${filterYear}`
  const selectedHasEarlyPayment = selectedStatus === 'future' && futureMonthsWithPayments.has(`${filterYear}-${filterMonth}`)

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tableau de Bord Financier</h1>
          <p className="text-slate-500 text-sm mt-1">Vue globale de la santé financière de l'établissement</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedYearId}
            onChange={(e) => setSelectedYearId(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
          >
            <option value="">Année en cours</option>
            {allYears.map((y) => <option key={y.id} value={y.id}>{y.startYear}/{y.endYear}</option>)}
          </select>
          <Link href="/dashboard/finance" className="text-sm text-[#00D1FF] hover:underline font-medium">
            Suivi détaillé →
          </Link>
        </div>
      </div>

      {/* Month tab bar */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {/* "Tous" tab */}
          <button
            onClick={() => { setFilterMonth(0); setFilterYear(0) }}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
              filterMonth === 0
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            Tous
          </button>

          {yearMonths.map(({ month, year: y }) => {
            const status = getMonthStatus(month, y)
            const isSelected = filterMonth === month && filterYear === y
            const hasEarlyPayment = status === 'future' && futureMonthsWithPayments.has(`${y}-${month}`)

            const statusStyles = {
              past: {
                base: 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-600',
                selected: 'bg-slate-100 text-slate-800 border-slate-300 shadow-sm',
                dot: 'bg-slate-300',
                badge: null,
              },
              current: {
                base: 'bg-white text-[#00D1FF] border-[#00D1FF]/30 hover:border-[#00D1FF]/60',
                selected: 'bg-[#00D1FF] text-white border-[#00D1FF] shadow-md',
                dot: isSelected ? 'bg-white' : 'bg-[#00D1FF]',
                badge: 'En cours',
              },
              future: {
                base: hasEarlyPayment
                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-300'
                  : 'bg-white text-slate-400 border-dashed border-slate-200 hover:border-slate-300 hover:text-slate-500',
                selected: hasEarlyPayment
                  ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                  : 'bg-slate-700 text-white border-slate-700 shadow-sm',
                dot: hasEarlyPayment
                  ? (isSelected ? 'bg-white' : 'bg-amber-400')
                  : 'bg-slate-400',
                badge: 'Futur',
              },
            }[status]

            return (
              <button
                key={`${y}-${month}`}
                onClick={() => { setFilterMonth(month); setFilterYear(y) }}
                className={`flex-shrink-0 flex flex-col items-start px-3.5 py-2 rounded-xl text-sm font-medium transition-all border min-w-[88px] ${
                  isSelected ? statusStyles.selected : statusStyles.base
                }`}
              >
                <div className="flex items-center gap-1.5 w-full">
                  {/* Status dot */}
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusStyles.dot} ${status === 'current' && !isSelected ? 'animate-pulse' : ''}`} />
                  <span className="truncate">{MONTHS_FR[month - 1].slice(0, 3)} {y}</span>
                  {/* Early payment lightning bolt for future months */}
                  {hasEarlyPayment && (
                    <span className={`ml-auto text-[11px] ${isSelected ? 'opacity-90' : 'text-amber-500'}`} title="Versement anticipé">⚡</span>
                  )}
                </div>
                {/* Status badge */}
                {statusStyles.badge && (
                  <span className={`text-[10px] font-medium mt-0.5 ml-3 ${
                    isSelected ? 'opacity-80'
                    : status === 'current' ? 'text-[#00D1FF]'
                    : hasEarlyPayment ? 'text-amber-500'
                    : 'text-slate-400'
                  }`}>
                    {hasEarlyPayment ? 'Versé en avance' : statusStyles.badge}
                  </span>
                )}
                {status === 'past' && (
                  <span className={`text-[10px] font-medium mt-0.5 ml-3 ${isSelected ? 'opacity-60' : 'text-slate-300'}`}>
                    Passé
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Context banner when a month is selected */}
        {selectedStatus && selectedMonthLabel && (
          <div className={`mt-3 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium w-fit ${
            selectedStatus === 'current'
              ? 'bg-[#00D1FF]/10 text-[#00D1FF] border border-[#00D1FF]/20'
              : selectedHasEarlyPayment
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : selectedStatus === 'future'
              ? 'bg-slate-100 text-slate-600 border border-slate-200'
              : 'bg-slate-50 text-slate-500 border border-slate-100'
          }`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              selectedStatus === 'current' ? 'bg-[#00D1FF] animate-pulse'
              : selectedHasEarlyPayment ? 'bg-amber-400'
              : selectedStatus === 'future' ? 'bg-slate-400'
              : 'bg-slate-300'
            }`} />
            {selectedMonthLabel}
            <span className="opacity-60 font-normal">·</span>
            <span className="opacity-70 font-normal text-xs">
              {selectedStatus === 'current' ? 'Mois en cours'
                : selectedHasEarlyPayment ? 'Mois futur — versements anticipés enregistrés'
                : selectedStatus === 'future' ? 'Mois futur — données prévisionnelles'
                : 'Mois passé — données historiques'}
            </span>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
        <KpiCard label="Total attendu" value={fmt(kpis.totalDue)} color="slate" />
        <KpiCard label="Total encaissé" value={fmt(kpis.totalPaid)} color="emerald" />
        <KpiCard label="Total réductions" value={fmt(kpis.totalReductions)} color="amber" />
        <KpiCard label="Dette totale" value={fmt(kpis.totalBalance)} color="red" />
        <KpiCard label="Taux recouvrement" value={`${kpis.rate} %`} color="cyan" />
        <KpiCard label="Élèves à jour" value={String(kpis.upToDate)} color="emerald" />
        <KpiCard label="Élèves en retard" value={String(kpis.late)} color="red" />
      </div>

      {/* Fee breakdown charts */}
      {feeBreakdown.length > 0 && (
        <FeeBreakdownSection feeBreakdown={feeBreakdown} fmt={fmt} />
      )}

      {/* Monthly Evolution Chart */}
      {monthlyEvolution.some((m) => m.due > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Évolution mensuelle</h2>
          <div className="flex items-end gap-2 h-40">
            {monthlyEvolution.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: '120px' }}>
                  {/* Due bar */}
                  <div
                    className="w-full rounded-t-sm bg-slate-100 relative overflow-hidden"
                    style={{ height: `${Math.max(2, (m.due / maxMonthly) * 120)}px` }}
                  >
                    {/* Paid fill */}
                    {m.paid > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-[#00D1FF] rounded-t-sm transition-all"
                        style={{ height: `${(m.paid / m.due) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                <span className="text-xs text-slate-400 text-center leading-tight">{m.label}</span>
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <p>Attendu : {fmt(m.due)}</p>
                  <p>Encaissé : {fmt(m.paid)}</p>
                  <p>Reste : {fmt(m.balance)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-100 inline-block" /> Attendu</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#00D1FF] inline-block" /> Encaissé</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top student debtors */}
        {allStudentDebtors.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-900">Top élèves débiteurs</h2>
              <span className="text-xs text-slate-400">{allStudentDebtors.length} au total</span>
            </div>
            <div className="space-y-2">
              {(showAllStudents ? allStudentDebtors : allStudentDebtors.slice(0, 10)).map(({ student, family, debt }, i) => (
                <div key={student.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-300 w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex flex-col min-w-0">
                        {family ? (
                          <>
                            <Link href={`/dashboard/eleves/famille/${family.id}`} className="text-sm font-medium text-slate-900 hover:text-[#00D1FF] truncate leading-tight">
                              {family.name}
                            </Link>
                            <span className="text-xs text-slate-400 truncate leading-tight">
                              {student.firstName} {student.lastName}
                            </span>
                          </>
                        ) : (
                          <Link href={`/dashboard/eleves/${student.id}`} className="text-sm font-medium text-slate-900 hover:text-[#00D1FF] truncate">
                            {student.firstName} {student.lastName}
                          </Link>
                        )}
                      </div>
                      <span className="text-sm font-bold text-red-500 ml-2 whitespace-nowrap">{fmt(debt)}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div
                        className="bg-red-400 h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, (debt / (allStudentDebtors[0]?.debt ?? 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {allStudentDebtors.length > 10 && (
              <button
                onClick={() => setShowAllStudents(!showAllStudents)}
                className="mt-4 w-full text-xs text-[#00D1FF] font-medium hover:underline py-1.5 border border-[#00D1FF]/20 rounded-lg hover:bg-[#00D1FF]/5 transition-colors"
              >
                {showAllStudents ? `▲ Réduire` : `▼ Voir les ${allStudentDebtors.length - 10} autres`}
              </button>
            )}
          </div>
        )}

        {/* Top family debtors */}
        {allFamilyDebtors.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-900">Top familles débitrices</h2>
              <span className="text-xs text-slate-400">{allFamilyDebtors.length} au total</span>
            </div>
            <div className="space-y-2">
              {(showAllFamilies ? allFamilyDebtors : allFamilyDebtors.slice(0, 10)).map(({ family, debt }, i) => (
                <div key={family.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-300 w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <Link href={`/dashboard/eleves/famille/${family.id}`} className="text-sm font-medium text-slate-900 hover:text-[#00D1FF] truncate">
                        {family.name}
                      </Link>
                      <span className="text-sm font-bold text-red-500 ml-2 whitespace-nowrap">{fmt(debt)}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div
                        className="bg-red-400 h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, (debt / (allFamilyDebtors[0]?.debt ?? 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {allFamilyDebtors.length > 10 && (
              <button
                onClick={() => setShowAllFamilies(!showAllFamilies)}
                className="mt-4 w-full text-xs text-[#00D1FF] font-medium hover:underline py-1.5 border border-[#00D1FF]/20 rounded-lg hover:bg-[#00D1FF]/5 transition-colors"
              >
                {showAllFamilies ? `▲ Réduire` : `▼ Voir les ${allFamilyDebtors.length - 10} autres`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Class breakdown */}
      {classBreakdown.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Taux de recouvrement par classe</h2>
          <div className="space-y-3">
            {classBreakdown.map(({ cls, due, paid, rate, balance }) => (
              <div key={cls.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-900">{cls.name}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-slate-500">Attendu : {fmt(due)}</span>
                    <span className="text-emerald-600 font-medium">Encaissé : {fmt(paid)}</span>
                    {balance > 0 && <span className="text-red-500 font-medium">Reste : {fmt(balance)}</span>}
                    <span className={`font-bold ${rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                      {rate} %
                    </span>
                  </div>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${rate >= 80 ? 'bg-emerald-400' : rate >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${rate}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Palette for fee types ──────────────────────────────────────────────────────
const FEE_COLORS = [
  { bg: '#00D1FF', light: '#e0f9ff', text: '#0099bb' },
  { bg: '#6366f1', light: '#ede9fe', text: '#4f46e5' },
  { bg: '#f59e0b', light: '#fef3c7', text: '#b45309' },
  { bg: '#10b981', light: '#d1fae5', text: '#059669' },
  { bg: '#ef4444', light: '#fee2e2', text: '#dc2626' },
  { bg: '#ec4899', light: '#fce7f3', text: '#db2777' },
  { bg: '#8b5cf6', light: '#ede9fe', text: '#7c3aed' },
  { bg: '#14b8a6', light: '#ccfbf1', text: '#0f766e' },
]

function DonutChart({ slices }: { slices: { value: number; color: string; label: string }[] }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0)
  if (total === 0) return null

  const R = 56
  const STROKE = 14
  const CX = 70
  const CY = 70
  const circumference = 2 * Math.PI * R
  const GAP = 0.012 * circumference // small gap between slices

  let offset = 0
  const paths = slices.map((sl, i) => {
    const ratio = sl.value / total
    const dash = Math.max(0, ratio * circumference - GAP)
    const path = { dashArray: `${dash} ${circumference - dash}`, dashOffset: -offset, color: sl.color, label: sl.label, value: sl.value, pct: Math.round(ratio * 100) }
    offset += ratio * circumference
    return path
  })

  return (
    <svg viewBox="0 0 140 140" className="w-36 h-36">
      {/* Background ring */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth={STROKE} />
      {paths.map((p, i) => (
        <circle key={i} cx={CX} cy={CY} r={R} fill="none"
          stroke={p.color} strokeWidth={STROKE}
          strokeDasharray={p.dashArray}
          strokeDashoffset={p.dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
      ))}
      {/* Center label */}
      <text x={CX} y={CY - 4} textAnchor="middle" className="text-xs" fill="#0f172a" style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>
        {slices.length}
      </text>
      <text x={CX} y={CY + 10} textAnchor="middle" fill="#94a3b8" style={{ fontFamily: 'inherit', fontSize: 8 }}>
        frais
      </text>
    </svg>
  )
}

function FeeBreakdownSection({
  feeBreakdown,
  fmt,
}: {
  feeBreakdown: { feeName: string; due: number; paid: number; balance: number; reductions: number }[]
  fmt: (n: number) => string
}) {
  const [activeTab, setActiveTab] = useState<'donut' | 'bars'>('donut')
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const totalDue = feeBreakdown.reduce((s, f) => s + f.due, 0)
  const totalPaid = feeBreakdown.reduce((s, f) => s + f.paid, 0)
  const totalBalance = feeBreakdown.reduce((s, f) => s + f.balance, 0)
  const totalReductions = feeBreakdown.reduce((s, f) => s + f.reductions, 0)

  // Donut slices — proportional to "due" (expected total per fee type)
  const donutSlices = feeBreakdown.map((f, i) => ({
    value: f.due,
    color: FEE_COLORS[i % FEE_COLORS.length].bg,
    label: f.feeName,
  }))

  const maxBar = Math.max(...feeBreakdown.map((f) => f.due), 1)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Répartition des frais</h2>
          <p className="text-xs text-slate-400 mt-0.5">Attendu · Versé · Reste · Réductions</p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-0.5">
          {(['donut', 'bars'] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${activeTab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t === 'donut' ? 'Camembert' : 'Barres'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'donut' ? (
        <div className="flex flex-col md:flex-row items-start gap-8">
          {/* Donut + center summary */}
          <div className="flex-shrink-0 flex flex-col items-center gap-3">
            <DonutChart slices={donutSlices} />
            {/* Mini totals under donut */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <span className="text-slate-400">Total attendu</span>
              <span className="font-semibold text-slate-900 text-right">{fmt(totalDue)}</span>
              <span className="text-slate-400">Versé</span>
              <span className="font-semibold text-emerald-600 text-right">{fmt(totalPaid)}</span>
              <span className="text-slate-400">Reste</span>
              <span className="font-semibold text-red-500 text-right">{fmt(totalBalance)}</span>
              {totalReductions > 0 && <>
                <span className="text-slate-400">Réductions</span>
                <span className="font-semibold text-amber-500 text-right">{fmt(totalReductions)}</span>
              </>}
            </div>
          </div>

          {/* Legend + per-fee detail */}
          <div className="flex-1 space-y-3 w-full">
            {feeBreakdown.map((f, i) => {
              const color = FEE_COLORS[i % FEE_COLORS.length]
              const paidPct = f.due > 0 ? Math.round((f.paid / f.due) * 100) : 0
              const isHovered = hoveredIdx === i
              return (
                <div key={f.feeName}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className={`rounded-xl border p-3.5 transition-all cursor-default ${isHovered ? 'border-slate-200 shadow-sm' : 'border-slate-100'}`}
                  style={{ background: isHovered ? color.light : undefined }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color.bg }} />
                      <span className="text-sm font-semibold text-slate-900">{f.feeName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-400">{Math.round((f.due / totalDue) * 100)} % du total</span>
                      <span className={`font-bold px-2 py-0.5 rounded-full ${paidPct >= 80 ? 'bg-emerald-100 text-emerald-700' : paidPct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                        {paidPct} %
                      </span>
                    </div>
                  </div>
                  {/* Progress bar: paid vs due */}
                  <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${paidPct}%`, background: color.bg }} />
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-slate-400 mb-0.5">Attendu</p>
                      <p className="font-semibold text-slate-900">{fmt(f.due)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 mb-0.5">Versé</p>
                      <p className="font-semibold text-emerald-600">{fmt(f.paid)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 mb-0.5">Reste</p>
                      <p className="font-semibold text-red-500">{fmt(f.balance)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 mb-0.5">Réductions</p>
                      <p className="font-semibold text-amber-500">{fmt(f.reductions)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Grouped bar chart view */
        <div>
          {/* Y-axis reference lines */}
          <div className="relative">
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              {[100, 75, 50, 25, 0].map((pct) => (
                <div key={pct} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 w-8 text-right flex-shrink-0">{pct}%</span>
                  <div className="flex-1 border-t border-slate-100" />
                </div>
              ))}
            </div>

            {/* Bars */}
            <div className="pl-10 flex items-end gap-4 pt-2" style={{ height: 200 }}>
              {feeBreakdown.map((f, i) => {
                const color = FEE_COLORS[i % FEE_COLORS.length]
                const duePct = (f.due / maxBar) * 160
                const paidPct = f.due > 0 ? (f.paid / f.due) * duePct : 0
                const balPct = f.due > 0 ? (f.balance / f.due) * duePct : 0
                const isHovered = hoveredIdx === i
                return (
                  <div key={f.feeName} className="flex-1 flex flex-col items-center gap-1 group relative"
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {/* 3 bars side by side */}
                    <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: 164 }}>
                      {/* Attendu */}
                      <div className="flex-1 rounded-t-md transition-all" title={`Attendu: ${fmt(f.due)}`}
                        style={{ height: duePct, background: '#e2e8f0', maxWidth: 20 }} />
                      {/* Versé */}
                      <div className="flex-1 rounded-t-md transition-all" title={`Versé: ${fmt(f.paid)}`}
                        style={{ height: paidPct, background: color.bg, maxWidth: 20 }} />
                      {/* Reste */}
                      <div className="flex-1 rounded-t-md transition-all" title={`Reste: ${fmt(f.balance)}`}
                        style={{ height: balPct, background: '#ef4444', maxWidth: 20, opacity: 0.7 }} />
                    </div>
                    <span className="text-xs text-slate-500 text-center truncate w-full" style={{ fontSize: 10 }}>
                      {f.feeName}
                    </span>

                    {/* Tooltip */}
                    {isHovered && (
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded-xl px-3 py-2.5 whitespace-nowrap z-20 shadow-xl">
                        <p className="font-semibold mb-1.5" style={{ color: color.bg }}>{f.feeName}</p>
                        <p className="flex justify-between gap-6"><span className="text-slate-300">Attendu</span><span>{fmt(f.due)}</span></p>
                        <p className="flex justify-between gap-6"><span className="text-slate-300">Versé</span><span className="text-emerald-400">{fmt(f.paid)}</span></p>
                        <p className="flex justify-between gap-6"><span className="text-slate-300">Reste</span><span className="text-red-400">{fmt(f.balance)}</span></p>
                        {f.reductions > 0 && <p className="flex justify-between gap-6"><span className="text-slate-300">Réductions</span><span className="text-amber-400">{fmt(f.reductions)}</span></p>}
                        <p className="flex justify-between gap-6 pt-1.5 border-t border-slate-700 mt-1.5"><span className="text-slate-300">Recouvrement</span><span className="font-bold">{f.due > 0 ? Math.round((f.paid / f.due) * 100) : 0} %</span></p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-4 pl-10 flex-wrap text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-200 inline-block" />Attendu</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#00D1FF] inline-block" />Versé</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block" />Reste dû</span>
          </div>

          {/* Summary table below bars */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left pb-2 text-slate-400 font-semibold uppercase">Frais</th>
                  <th className="text-right pb-2 text-slate-400 font-semibold uppercase">Attendu</th>
                  <th className="text-right pb-2 text-slate-400 font-semibold uppercase">Versé</th>
                  <th className="text-right pb-2 text-slate-400 font-semibold uppercase">Reste</th>
                  <th className="text-right pb-2 text-slate-400 font-semibold uppercase">Réductions</th>
                  <th className="text-right pb-2 text-slate-400 font-semibold uppercase">Taux</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {feeBreakdown.map((f, i) => {
                  const color = FEE_COLORS[i % FEE_COLORS.length]
                  const rate = f.due > 0 ? Math.round((f.paid / f.due) * 100) : 0
                  return (
                    <tr key={f.feeName} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color.bg }} />
                          <span className="font-medium text-slate-900">{f.feeName}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right text-slate-700">{fmt(f.due)}</td>
                      <td className="py-2 text-right text-emerald-600 font-medium">{fmt(f.paid)}</td>
                      <td className="py-2 text-right text-red-500 font-medium">{fmt(f.balance)}</td>
                      <td className="py-2 text-right text-amber-500">{fmt(f.reductions)}</td>
                      <td className="py-2 text-right">
                        <span className={`font-bold px-2 py-0.5 rounded-full ${rate >= 80 ? 'bg-emerald-100 text-emerald-700' : rate >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                          {rate} %
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {/* Total row */}
                <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
                  <td className="py-2.5">Total</td>
                  <td className="py-2.5 text-right">{fmt(totalDue)}</td>
                  <td className="py-2.5 text-right text-emerald-600">{fmt(totalPaid)}</td>
                  <td className="py-2.5 text-right text-red-500">{fmt(totalBalance)}</td>
                  <td className="py-2.5 text-right text-amber-500">{fmt(totalReductions)}</td>
                  <td className="py-2.5 text-right">
                    <span className={`font-bold px-2 py-0.5 rounded-full ${totalDue > 0 && Math.round((totalPaid / totalDue) * 100) >= 80 ? 'bg-emerald-100 text-emerald-700' : totalDue > 0 && Math.round((totalPaid / totalDue) * 100) >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                      {totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0} %
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, color }: { label: string; value: string; color: 'slate' | 'emerald' | 'red' | 'cyan' | 'amber' }) {
  const colors = { slate: 'text-slate-900', emerald: 'text-emerald-600', red: 'text-red-500', cyan: 'text-[#00D1FF]', amber: 'text-amber-500' }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 col-span-1">
      <p className="text-xs text-slate-500 font-medium mb-1 leading-tight">{label}</p>
      <p className={`text-lg font-bold ${colors[color]}`}>{value}</p>
    </div>
  )
}
