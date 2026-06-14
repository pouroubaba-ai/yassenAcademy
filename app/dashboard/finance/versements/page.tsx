'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc,
  orderBy, limit, onSnapshot,
} from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { useCurrency } from '../../../_lib/currency-context'
import { Student, Family, Fee, MonthlyEntry, Payment } from '../../../_lib/types'
import {
  allocatePayment, allocateFamilyPayment, applyAllocationsToEntries,
  reverseAllocationsOnEntries, buildVirtualEntry, resolveEntry, monthLabel, getSchoolYearMonths,
  MONTHS_FR,
} from '../../../_lib/finance-utils'

type SearchType = 'eleve' | 'famille'

export default function VersementsPage() {
  const { activeYear, uid } = useSchoolYear()
  const { fmt, symbol } = useCurrency()

  const [searchType, setSearchType] = useState<SearchType>('eleve')
  const [searchQuery, setSearchQuery] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [families, setFamilies] = useState<Family[]>([])
  const [fees, setFees] = useState<Fee[]>([])
  const [payments, setPayments] = useState<Payment[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // realEntries = entries already in Firestore (may have balance > 0 OR = 0)
  const [realEntries, setRealEntries] = useState<MonthlyEntry[]>([])
  // virtualEntries = future months not yet in Firestore
  const [virtualEntries, setVirtualEntries] = useState<(MonthlyEntry & { id: '__virtual__' })[]>([])
  const [includeFuture, setIncludeFuture] = useState(false)
  const [loadingEntries, setLoadingEntries] = useState(false)

  const [selectedFeeIds, setSelectedFeeIds] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // Receipt & cancel state
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Payment | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const yearId = activeYear?.id ?? ''

  useEffect(() => {
    if (!yearId || !uid) return
    const u1 = onSnapshot(query(collection(db, 'students'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setStudents(s.docs.map((d) => ({ id: d.id, ...d.data() } as Student))))
    const u2 = onSnapshot(query(collection(db, 'families'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setFamilies(s.docs.map((d) => ({ id: d.id, ...d.data() } as Family))))
    const u3 = onSnapshot(query(collection(db, 'fees'), where('schoolYearId', '==', yearId), where('userId', '==', uid)), (s) =>
      setFees(s.docs.map((d) => ({ id: d.id, ...d.data() } as Fee))))
    const u4 = onSnapshot(
      query(collection(db, 'payments'), where('schoolYearId', '==', yearId), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(30)),
      (s) => setPayments(s.docs.map((d) => ({ id: d.id, ...d.data() } as Payment)))
    )
    return () => { u1(); u2(); u3(); u4() }
  }, [yearId, uid])

  async function loadEntries(id: string, type: SearchType) {
    setLoadingEntries(true)
    setRealEntries([])
    setVirtualEntries([])
    setSelectedFeeIds(new Set())
    setAmount('')
    setWarning(null)
    setShowPreview(false)
    setIncludeFuture(false)

    let allReal: MonthlyEntry[] = []

    if (type === 'eleve') {
      const snap = await getDocs(
        query(collection(db, 'monthlyEntries'), where('studentId', '==', id), where('schoolYearId', '==', yearId), ...(uid ? [where('userId', '==', uid)] : []))
      )
      allReal = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MonthlyEntry))
    } else {
      const memberIds = students.filter((s) => s.familyId === id && s.isActive).map((s) => s.id)
      if (memberIds.length > 0) {
        const snaps = await Promise.all(
          memberIds.map((sid) =>
            getDocs(query(collection(db, 'monthlyEntries'), where('studentId', '==', sid), where('schoolYearId', '==', yearId), ...(uid ? [where('userId', '==', uid)] : [])))
          )
        )
        allReal = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() } as MonthlyEntry)))
      }
    }

    // Resolve all entries dynamically so new fees / changed reductions are reflected
    const resolvedReal = allReal.map((e) => {
      const student = students.find((s) => s.id === e.studentId)
      return resolveEntry(e, student, fees)
    })

    // Split: past/current months with debt = real debt; future months = treated as virtual
    const now = new Date()
    const nowYear = now.getFullYear()
    const nowMonth = now.getMonth() + 1
    const isMonthFuture = (m: number, y: number) =>
      y > nowYear || (y === nowYear && m > nowMonth)

    const pastDebtEntries = resolvedReal.filter(
      (e) => e.totalBalance > 0 && !isMonthFuture(e.month, e.year)
    )
    const futureRealDebt = resolvedReal.filter(
      (e) => e.totalBalance > 0 && isMonthFuture(e.month, e.year)
    )

    setRealEntries(pastDebtEntries)

    // Virtual entries = future Firestore entries (pre-generated) + truly virtual (not yet in Firestore)
    if (activeYear) {
      const allMonths = getSchoolYearMonths(activeYear)
      const futureMonths = allMonths.filter(({ month, year }) => isMonthFuture(month, year))
      const existingKeys = new Set(resolvedReal.map((e) => `${e.year}-${e.month}-${e.studentId}`))

      const trulyVirtual: (MonthlyEntry & { id: '__virtual__' })[] = []

      if (type === 'eleve') {
        const student = students.find((s) => s.id === id)
        if (student) {
          for (const { month, year } of futureMonths) {
            if (!existingKeys.has(`${year}-${month}-${id}`)) {
              const ve = buildVirtualEntry(id, yearId, month, year, student.appliedFees, fees)
              if (ve.totalDue > 0) trulyVirtual.push(ve as MonthlyEntry & { id: '__virtual__' })
            }
          }
        }
      } else {
        const memberIds = students.filter((s) => s.familyId === id && s.isActive).map((s) => s.id)
        for (const sid of memberIds) {
          const student = students.find((s) => s.id === sid)
          if (!student) continue
          for (const { month, year } of futureMonths) {
            if (!existingKeys.has(`${year}-${month}-${sid}`)) {
              const ve = buildVirtualEntry(sid, yearId, month, year, student.appliedFees, fees)
              if (ve.totalDue > 0) trulyVirtual.push(ve as MonthlyEntry & { id: '__virtual__' })
            }
          }
        }
      }

      // Merge: future resolved Firestore entries first (they have real IDs), then truly virtual
      setVirtualEntries([...(futureRealDebt as any), ...trulyVirtual])
    }

    setLoadingEntries(false)
  }

  function selectSubject(id: string) {
    setSelectedId(id)
    loadEntries(id, searchType)
  }

  // Entries to use for payment (real + optionally virtual)
  const activeEntries = useMemo(() => {
    const real = realEntries as MonthlyEntry[]
    const future = includeFuture ? (virtualEntries as MonthlyEntry[]) : []
    return [...real, ...future]
  }, [realEntries, virtualEntries, includeFuture])

  // All fee types present in activeEntries
  const allFeeIds = useMemo(() => {
    const map: Record<string, string> = {}
    for (const entry of activeEntries) {
      for (const ef of entry.fees) {
        if (ef.balance > 0) map[ef.feeId] = ef.feeName
      }
    }
    return map
  }, [activeEntries])

  function toggleFee(feeId: string) {
    setSelectedFeeIds((prev) => {
      const next = new Set(prev)
      if (next.has(feeId)) { next.delete(feeId) } else { next.add(feeId) }
      return next
    })
  }

  const maxAmount = useMemo(() => {
    if (selectedFeeIds.size === 0) return 0
    const feeIds = Array.from(selectedFeeIds)
    return activeEntries.reduce((sum, e) =>
      sum + e.fees.filter((ef) => feeIds.includes(ef.feeId)).reduce((s, ef) => s + ef.balance, 0), 0
    )
  }, [activeEntries, selectedFeeIds])

  const { allocations, allocationWarning } = useMemo(() => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0 || selectedFeeIds.size === 0) return { allocations: [], allocationWarning: null }
    const feeIds = Array.from(selectedFeeIds)
    const capped = Math.min(amt, maxAmount)

    if (searchType === 'eleve') {
      return { allocations: allocatePayment(activeEntries, capped, feeIds), allocationWarning: null }
    } else {
      if (!selectedId) return { allocations: [], allocationWarning: null }
      const memberIds = students.filter((s) => s.familyId === selectedId && s.isActive).map((s) => s.id)
      const byStudent: Record<string, MonthlyEntry[]> = {}
      for (const sid of memberIds) byStudent[sid] = activeEntries.filter((e) => e.studentId === sid)
      const { allocations, warning } = allocateFamilyPayment(byStudent, memberIds, capped, feeIds)
      return { allocations, allocationWarning: warning }
    }
  }, [activeEntries, selectedFeeIds, amount, searchType, selectedId, students, maxAmount])

  async function confirmPayment() {
    if (!activeYear || !selectedId || allocations.length === 0) return
    setSaving(true)

    const totalAmount = allocations.reduce((s, a) => s + a.amount, 0)
    const primaryStudentId = searchType === 'eleve'
      ? selectedId
      : (students.find((s) => s.familyId === selectedId)?.id ?? '')

    try {
      // Create real entries for virtual months that will receive allocation
      const virtualIdsNeeded = new Set(
        allocations.filter((a) => a.monthlyEntryId === '__virtual__').map((a) => `${a.year}-${a.month}-${a.studentId}`)
      )
      const virtualToCreate = virtualEntries.filter((ve) =>
        virtualIdsNeeded.has(`${ve.year}-${ve.month}-${ve.studentId}`)
      )
      const createdEntryMap: Record<string, string> = {} // virtualKey → real id

      for (const ve of virtualToCreate) {
        const { id: _, ...data } = ve
        const ref = await addDoc(collection(db, 'monthlyEntries'), {
          ...data, userId: uid, generatedAt: new Date().toISOString(),
        })
        createdEntryMap[`${ve.year}-${ve.month}-${ve.studentId}`] = ref.id
      }

      // Replace __virtual__ ids in allocations with real ids
      const finalAllocations = allocations.map((a) => {
        if (a.monthlyEntryId !== '__virtual__') return a
        const key = `${a.year}-${a.month}-${a.studentId}`
        return { ...a, monthlyEntryId: createdEntryMap[key] ?? a.monthlyEntryId }
      })

      // Get all affected real entries (including just-created ones)
      const allRealIds = [...new Set(finalAllocations.map((a) => a.monthlyEntryId))]
      const entrySnaps = await Promise.all(allRealIds.map((id) => getDoc(doc(db, 'monthlyEntries', id))))
      const allAffectedEntries = entrySnaps
        .filter((s) => s.exists())
        .map((s) => {
          const entry = { id: s.id, ...s.data() } as MonthlyEntry
          // Re-resolve to pick up new fees / changed reductions before applying payment
          const student = students.find((st) => st.id === entry.studentId)
          return resolveEntry(entry, student, fees)
        })

      const updatedEntries = applyAllocationsToEntries(allAffectedEntries, finalAllocations)

      await addDoc(collection(db, 'payments'), {
        schoolYearId: yearId,
        userId: uid,
        studentId: primaryStudentId,
        familyId: searchType === 'famille' ? selectedId : null,
        totalAmount,
        date: new Date().toISOString().split('T')[0],
        note: note.trim() || null,
        allocations: finalAllocations,
        createdAt: new Date().toISOString(),
      })

      await Promise.all(
        updatedEntries
          .filter((ue) => {
            const orig = allAffectedEntries.find((e) => e.id === ue.id)
            return orig && ue.totalPaid !== orig.totalPaid
          })
          .map((ue) => updateDoc(doc(db, 'monthlyEntries', ue.id), { fees: ue.fees, totalPaid: ue.totalPaid, totalBalance: ue.totalBalance }))
      )

      setSuccessMsg(`Versement de ${fmt(totalAmount)} enregistré.`)
      setSelectedId(null)
      setRealEntries([])
      setVirtualEntries([])
      setSelectedFeeIds(new Set())
      setAmount('')
      setNote('')
      setShowPreview(false)
      setWarning(null)
      setIncludeFuture(false)
      setTimeout(() => setSuccessMsg(''), 4000)
    } finally {
      setSaving(false)
    }
  }

  async function cancelPayment(payment: Payment) {
    setCancelling(true)
    try {
      const entryIds = [...new Set(payment.allocations.map((a) => a.monthlyEntryId))]
      const snaps = await Promise.all(entryIds.map((id) => getDoc(doc(db, 'monthlyEntries', id))))
      const affected = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() } as MonthlyEntry))
      const reversed = reverseAllocationsOnEntries(affected, payment.allocations)

      await Promise.all([
        ...reversed.map((ue) => updateDoc(doc(db, 'monthlyEntries', ue.id), { fees: ue.fees, totalPaid: ue.totalPaid, totalBalance: ue.totalBalance })),
        deleteDoc(doc(db, 'payments', payment.id)),
      ])
    } finally {
      setCancelling(false)
      setCancelTarget(null)
    }
  }

  const selectedStudent = selectedId && searchType === 'eleve' ? students.find((s) => s.id === selectedId) : null
  const selectedFamily = selectedId && searchType === 'famille' ? families.find((f) => f.id === selectedId) : null
  const totalDebt = realEntries.reduce((s, e) => s + e.totalBalance, 0)
  const totalFuture = virtualEntries.reduce((s, e) => s + e.totalBalance, 0)

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    if (searchType === 'eleve') return students.filter((s) => s.isActive && `${s.firstName} ${s.lastName}`.toLowerCase().includes(q)).slice(0, 8)
    return families.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8)
  }, [searchQuery, searchType, students, families])

  const entriesByMonth = useMemo(() => {
    const map: Record<string, { entries: MonthlyEntry[]; isFuture: boolean }> = {}
    const now = new Date()
    const nowYear = now.getFullYear()
    const nowMonth = now.getMonth() + 1
    for (const e of activeEntries) {
      const key = `${e.year}-${String(e.month).padStart(2, '0')}`
      const future = e.year > nowYear || (e.year === nowYear && e.month > nowMonth)
      if (!map[key]) map[key] = { entries: [], isFuture: future }
      map[key].entries.push(e)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [activeEntries])

  if (!activeYear) return <div className="p-8"><p className="text-slate-500 text-sm">Aucune année scolaire active.</p></div>

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard/finance" className="text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Enregistrer un versement</h1>
          <p className="text-slate-500 text-sm mt-0.5">Recherchez un élève ou une famille</p>
        </div>
      </div>

      {successMsg && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3 text-sm font-medium">
          ✓ {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Search + debt panel */}
        <div className="space-y-4">
          <div className="flex rounded-xl bg-slate-100 p-0.5 w-fit">
            {(['eleve', 'famille'] as SearchType[]).map((t) => (
              <button key={t} onClick={() => { setSearchType(t); setSelectedId(null); setRealEntries([]); setVirtualEntries([]); setSearchQuery('') }}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${searchType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t === 'eleve' ? 'Élève' : 'Famille'}
              </button>
            ))}
          </div>

          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchType === 'eleve' ? "Nom de l'élève…" : 'Nom de la famille…'}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
            {searchResults.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-lg z-20 overflow-hidden">
                {searchResults.map((item) => (
                  <button key={item.id} onClick={() => { selectSubject(item.id); setSearchQuery('') }}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0 text-slate-900">
                    {'firstName' in item ? `${item.firstName} ${item.lastName}` : item.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loadingEntries && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loadingEntries && selectedId && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-900">
                    {selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : selectedFamily?.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Dette actuelle : <span className="font-semibold text-red-500">{fmt(totalDebt)}</span>
                    {virtualEntries.length > 0 && (
                      <span className="ml-2 text-slate-400">+ {fmt(totalFuture)} futurs potentiels</span>
                    )}
                  </p>
                </div>
                <button onClick={() => { setSelectedId(null); setRealEntries([]); setVirtualEntries([]) }} className="text-slate-300 hover:text-slate-500">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {realEntries.length === 0 && virtualEntries.length === 0 ? (
                <div className="px-5 py-6 text-center text-slate-400 text-sm">Aucune dette en cours. 🎉</div>
              ) : (
                <>
                  <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                    {entriesByMonth.map(([key, { entries: monthEntries, isFuture }]) => {
                      const first = monthEntries[0]
                      const monthTotal = monthEntries.reduce((s, e) => s + e.totalBalance, 0)
                      return (
                        <div key={key} className={`px-5 py-3 ${isFuture ? 'bg-amber-50/50' : ''}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-500 uppercase">{monthLabel(first.month, first.year)}</p>
                              {isFuture && <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">Futur</span>}
                            </div>
                            <span className="text-xs font-bold text-red-500">{fmt(monthTotal)}</span>
                          </div>
                          {monthEntries.map((entry) =>
                            entry.fees.filter((ef) => ef.balance > 0).map((ef) => (
                              <div key={`${entry.id}-${ef.feeId}`} className="flex items-center justify-between py-0.5">
                                <span className="text-xs text-slate-600">{ef.feeName}</span>
                                <span className="text-xs text-slate-900">{fmt(ef.balance)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Toggle future months */}
                  {virtualEntries.length > 0 && (
                    <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} className="w-4 h-4 accent-[#00D1FF]" />
                        <span className="text-sm text-slate-700">
                          Inclure les mois futurs <span className="text-slate-500">({fmt(totalFuture)})</span>
                        </span>
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Payment form */}
        {selectedId && activeEntries.length > 0 && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <p className="text-sm font-bold text-slate-900 mb-3">Frais à solder</p>
              <div className="space-y-2">
                {Object.entries(allFeeIds).map(([feeId, feeName]) => {
                  const feeBalance = activeEntries.reduce((s, e) => {
                    const ef = e.fees.find((f) => f.feeId === feeId)
                    return s + (ef?.balance ?? 0)
                  }, 0)
                  return (
                    <label key={feeId} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedFeeIds.has(feeId) ? 'border-[#00D1FF]/30 bg-[#00D1FF]/5' : 'border-slate-100 hover:bg-slate-50'}`}>
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={selectedFeeIds.has(feeId)} onChange={() => toggleFee(feeId)} className="w-4 h-4 accent-[#00D1FF]" />
                        <span className="text-sm text-slate-700">{feeName}</span>
                      </div>
                      <span className="text-sm font-semibold text-red-500">{fmt(feeBalance)}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {selectedFeeIds.size > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-slate-700">Montant versé</label>
                    <button onClick={() => setAmount(String(maxAmount))} className="text-xs text-[#00D1FF] hover:underline">
                      Max : {fmt(maxAmount)}
                    </button>
                  </div>
                  <div className="relative">
                    <input type="number" min="0" step="1" value={amount}
                      onChange={(e) => {
                        const raw = e.target.value
                        const num = parseFloat(raw)
                        if (!isNaN(num) && num > maxAmount) {
                          setAmount(String(maxAmount))
                          setWarning(`Montant plafonné à la dette sélectionnée (${fmt(maxAmount)})`)
                        } else {
                          setAmount(raw)
                          setWarning(null)
                        }
                      }}
                      placeholder="0"
                      className={`w-full px-4 py-2.5 pr-14 rounded-xl border text-slate-900 text-sm focus:outline-none focus:ring-2 ${parseFloat(amount) > maxAmount ? 'border-red-300 focus:ring-red-200' : 'border-slate-200 focus:ring-[#00D1FF]'}`} />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{symbol}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Note (optionnel)</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: Chèque n°1234…"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                </div>

                {(allocationWarning || warning) && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-xs">{allocationWarning ?? warning}</div>
                )}

                {allocations.length > 0 && (
                  <div>
                    <button onClick={() => setShowPreview(!showPreview)} className="text-sm text-[#00D1FF] font-medium hover:underline">
                      {showPreview ? '▲ Masquer' : '▼ Aperçu de la répartition'}
                    </button>
                    {showPreview && (
                      <div className="mt-3 bg-slate-50 rounded-xl p-4 space-y-1.5 text-xs max-h-48 overflow-y-auto">
                        {allocations.map((a, i) => (
                          <div key={i} className="flex items-center justify-between text-slate-600">
                            <span>{monthLabel(a.month, a.year)} — {a.feeName}</span>
                            <span className="font-semibold text-slate-900">{fmt(a.amount)}</span>
                          </div>
                        ))}
                        <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold text-slate-900">
                          <span>Total</span>
                          <span>{fmt(allocations.reduce((s, a) => s + a.amount, 0))}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button onClick={confirmPayment} disabled={saving || allocations.length === 0 || !parseFloat(amount)}
                  className="w-full py-3 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                  {saving ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Enregistrement…</>
                  ) : `Confirmer le versement de ${amount ? fmt(parseFloat(amount)) : '—'}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent payments history */}
      {payments.length > 0 && (
        <div className="mt-10">
          <h2 className="text-base font-bold text-slate-900 mb-4">Versements récents</h2>
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Élève / Famille</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Montant</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Note</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {payments.map((p) => {
                  const student = students.find((s) => s.id === p.studentId)
                  const family = p.familyId ? families.find((f) => f.id === p.familyId) : null
                  const label = family ? family.name : student ? `${student.firstName} ${student.lastName}` : '—'
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-slate-600">{new Date(p.date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-5 py-3 font-medium text-slate-900">{label}</td>
                      <td className="px-5 py-3 text-right font-semibold text-emerald-600">{fmt(p.totalAmount)}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">{p.note || '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setReceiptPayment(p)}
                            className="text-xs text-[#00D1FF] hover:underline font-medium px-2 py-1 rounded-lg hover:bg-[#00D1FF]/10 transition-colors">
                            Reçu
                          </button>
                          <button onClick={() => setCancelTarget(p)}
                            className="text-xs text-red-400 hover:text-red-600 hover:underline font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                            Annuler
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancel confirmation modal */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-sm w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-slate-900 mb-2">Annuler ce versement ?</h2>
            <p className="text-sm text-slate-600 mb-1">
              Montant : <strong className="text-slate-900">{fmt(cancelTarget.totalAmount)}</strong>
            </p>
            <p className="text-sm text-slate-600 mb-5">
              Date : {new Date(cancelTarget.date).toLocaleDateString('fr-FR')}
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
              Cette action est irréversible. Les dettes des élèves concernés seront restaurées.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setCancelTarget(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
                Garder
              </button>
              <button onClick={() => cancelPayment(cancelTarget)} disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-60 transition-colors">
                {cancelling ? 'Annulation…' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {receiptPayment && (
        <PaymentReceiptModal
          payment={receiptPayment}
          students={students}
          families={families}
          fmt={fmt}
          symbol={symbol}
          schoolYearLabel={`${activeYear.startYear}/${activeYear.endYear}`}
          onClose={() => setReceiptPayment(null)}
        />
      )}
    </div>
  )
}

function PaymentReceiptModal({
  payment, students, families, fmt, symbol, schoolYearLabel, onClose,
}: {
  payment: Payment
  students: Student[]
  families: Family[]
  fmt: (n: number) => string
  symbol: string
  schoolYearLabel: string
  onClose: () => void
}) {
  const { uid } = useSchoolYear()
  const [schoolName, setSchoolName] = useState('Yassen Academy')
  const [schoolAddress, setSchoolAddress] = useState('')
  const [schoolPhone, setSchoolPhone] = useState('')
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!uid) return
    getDoc(doc(db, 'settings', uid)).then((s) => {
      if (s.exists()) {
        const d = s.data()
        if (d.name) setSchoolName(d.name)
        if (d.address) setSchoolAddress(d.address)
        if (d.phone) setSchoolPhone(d.phone)
      }
    })
  }, [uid])

  const student = students.find((s) => s.id === payment.studentId)
  const family = payment.familyId ? families.find((f) => f.id === payment.familyId) : null
  const label = family ? family.name : student ? `${student.firstName} ${student.lastName}` : '—'
  const receiptNo = payment.id.slice(-8).toUpperCase()

  // Group allocations by month then by student
  const byMonth: Record<string, { month: number; year: number; rows: { studentName: string; feeName: string; amount: number }[] }> = {}
  for (const a of payment.allocations) {
    const key = `${a.year}-${String(a.month).padStart(2, '0')}`
    if (!byMonth[key]) byMonth[key] = { month: a.month, year: a.year, rows: [] }
    const s = students.find((st) => st.id === a.studentId)
    byMonth[key].rows.push({
      studentName: s ? `${s.firstName} ${s.lastName}` : '—',
      feeName: a.feeName,
      amount: a.amount,
    })
  }
  const monthGroups = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))

  function handlePrint() {
    document.body.classList.add('printing-receipt')
    window.print()
    // Remove class after print dialog closes
    const cleanup = () => {
      document.body.classList.remove('printing-receipt')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
  }

  return (
    <div className="receipt-print-root fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" ref={printRef}>
        {/* Header toolbar (hidden on print) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 print:hidden">
          <h2 className="text-base font-bold text-slate-900">Reçu de paiement</h2>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-[#00D1FF] text-white text-sm font-semibold rounded-xl hover:bg-[#00b8e0] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimer
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Receipt content */}
        <div className="p-8">
          {/* School header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{schoolName}</h1>
              {schoolAddress && <p className="text-sm text-slate-500 mt-0.5">{schoolAddress}</p>}
              {schoolPhone && <p className="text-sm text-slate-500">{schoolPhone}</p>}
              <p className="text-xs text-slate-400 mt-1">Année scolaire {schoolYearLabel}</p>
            </div>
            <div className="text-right">
              <div className="inline-block bg-[#00D1FF]/10 rounded-xl px-4 py-2">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Reçu N°</p>
                <p className="text-lg font-bold text-[#00D1FF]">{receiptNo}</p>
              </div>
            </div>
          </div>

          <div className="w-full h-px bg-slate-200 mb-6" />

          {/* Payment info */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-xs text-slate-400 uppercase font-medium mb-1">Payeur</p>
              <p className="text-sm font-semibold text-slate-900">{label}</p>
              {family && <p className="text-xs text-slate-500">Famille</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400 uppercase font-medium mb-1">Date du versement</p>
              <p className="text-sm font-semibold text-slate-900">{new Date(payment.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>

          {/* Allocations table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Mois</th>
                  {family && <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Élève</th>}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Frais</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthGroups.map(([key, { month, year, rows }]) =>
                  rows.map((row, ri) => (
                    <tr key={`${key}-${ri}`} className="hover:bg-slate-50">
                      {ri === 0 ? (
                        <td className="px-4 py-2.5 text-slate-700 font-medium" rowSpan={rows.length}>
                          {MONTHS_FR[month - 1]} {year}
                        </td>
                      ) : null}
                      {family && <td className="px-4 py-2.5 text-slate-600 text-xs">{row.studentName}</td>}
                      <td className="px-4 py-2.5 text-slate-700">{row.feeName}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{fmt(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="flex justify-end">
            <div className="bg-slate-900 text-white rounded-xl px-6 py-4 flex items-center gap-8">
              <p className="text-sm font-medium opacity-80">Total versé</p>
              <p className="text-2xl font-bold">{fmt(payment.totalAmount)}</p>
            </div>
          </div>

          {payment.note && (
            <p className="mt-4 text-xs text-slate-500 italic">Note : {payment.note}</p>
          )}

          <div className="mt-8 pt-6 border-t border-slate-100 text-center text-xs text-slate-400">
            Reçu généré le {new Date().toLocaleDateString('fr-FR')} — {schoolName}
          </div>
        </div>
      </div>
    </div>
  )
}
