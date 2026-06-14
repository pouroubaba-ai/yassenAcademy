'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { doc, getDoc, updateDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore'
import { db } from '../../../../_lib/firebase'
import { useSchoolYear } from '../../../../_lib/school-year-context'
import { useCurrency } from '../../../../_lib/currency-context'
import { Family, Student, Fee, SchoolClass, Contact } from '../../../../_lib/types'
import PhoneInput, { buildFullPhone } from '../../../../_components/PhoneInput'

export default function FamilyPage({ params }: PageProps<'/dashboard/eleves/famille/[id]'>) {
  const router = useRouter()
  const { uid } = useSchoolYear()
  const { symbol, fmt } = useCurrency()
  const [family, setFamily] = useState<Family | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [fees, setFees] = useState<Fee[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [loading, setLoading] = useState(true)
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [allStudents, setAllStudents] = useState<Student[]>([])

  // Contacts editing
  const [editingContacts, setEditingContacts] = useState(false)
  const [editContacts, setEditContacts] = useState<Contact[]>([])
  const [savingContacts, setSavingContacts] = useState(false)

  // Student picker modal
  const [showStudentPicker, setShowStudentPicker] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')
  const [assigningStudent, setAssigningStudent] = useState<string | null>(null)
  const [familyNames, setFamilyNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let unsubStudents: (() => void) | undefined
    let unsubAll: (() => void) | undefined

    params.then(async ({ id }) => {
      setFamilyId(id)
      const famSnap = await getDoc(doc(db, 'families', id))
      if (!famSnap.exists()) { router.push('/dashboard/eleves'); return }
      const fam = { id: famSnap.id, ...famSnap.data() } as Family
      setFamily(fam)

      const [feesSnap, classesSnap] = await Promise.all([
        getDocs(query(collection(db, 'fees'), where('schoolYearId', '==', fam.schoolYearId), ...(uid ? [where('userId', '==', uid)] : []))),
        getDocs(query(collection(db, 'classes'), where('schoolYearId', '==', fam.schoolYearId), ...(uid ? [where('userId', '==', uid)] : []))),
      ])
      setFees(feesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Fee)))
      setClasses(classesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolClass)))

      unsubStudents = onSnapshot(
        query(collection(db, 'students'), where('familyId', '==', id), ...(uid ? [where('userId', '==', uid)] : [])),
        (snap) => {
          setStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)))
          setLoading(false)
        }
      )

      // All active students of this school year (for the picker)
      unsubAll = onSnapshot(
        query(collection(db, 'students'), where('schoolYearId', '==', fam.schoolYearId), where('isActive', '==', true), ...(uid ? [where('userId', '==', uid)] : [])),
        (snap) => setAllStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)))
      )
    })

    return () => { unsubStudents?.(); unsubAll?.() }
  }, [])

  async function toggleFeeForFamily(feeId: string, apply: boolean, reduction = 0) {
    const updates = students.map((s) => {
      let updated: typeof s.appliedFees
      if (apply) {
        if (s.appliedFees.some((af) => af.feeId === feeId)) {
          updated = s.appliedFees.map((af) => af.feeId === feeId ? { ...af, reduction } : af)
        } else {
          updated = [...s.appliedFees, { feeId, reduction }]
        }
      } else {
        updated = s.appliedFees.filter((af) => af.feeId !== feeId)
      }
      return { id: s.id, appliedFees: updated }
    })

    setStudents((prev) => prev.map((s) => {
      const u = updates.find((x) => x.id === s.id)
      return u ? { ...s, appliedFees: u.appliedFees } : s
    }))

    await Promise.all(updates.map((u) => updateDoc(doc(db, 'students', u.id), { appliedFees: u.appliedFees })))
  }

  async function toggleFeeForStudent(studentId: string, feeId: string) {
    const s = students.find((st) => st.id === studentId)
    if (!s) return
    const has = s.appliedFees.some((af) => af.feeId === feeId)
    const updated = has
      ? s.appliedFees.filter((af) => af.feeId !== feeId)
      : [...s.appliedFees, { feeId, reduction: 0 }]
    setStudents((prev) => prev.map((st) => st.id === studentId ? { ...st, appliedFees: updated } : st))
    await updateDoc(doc(db, 'students', studentId), { appliedFees: updated })
  }

  async function updateStudentReduction(studentId: string, feeId: string, reduction: number) {
    const s = students.find((st) => st.id === studentId)
    if (!s) return
    const has = s.appliedFees.some((af) => af.feeId === feeId)
    const updated = has
      ? s.appliedFees.map((af) => af.feeId === feeId ? { ...af, reduction } : af)
      : [...s.appliedFees, { feeId, reduction }]
    setStudents((prev) => prev.map((st) => st.id === studentId ? { ...st, appliedFees: updated } : st))
    await updateDoc(doc(db, 'students', studentId), { appliedFees: updated })
  }

  // Load names for "other" families referenced by allStudents
  useEffect(() => {
    const ids = [...new Set(
      allStudents.filter(s => s.familyId && s.familyId !== familyId).map(s => s.familyId!)
    )]
    if (ids.length === 0) return
    const missing = ids.filter(id => !familyNames[id])
    if (missing.length === 0) return
    Promise.all(missing.map(id => getDoc(doc(db, 'families', id)))).then(snaps => {
      const map: Record<string, string> = {}
      snaps.forEach(s => { if (s.exists()) map[s.id] = (s.data() as Family).name })
      setFamilyNames(prev => ({ ...prev, ...map }))
    })
  }, [allStudents, familyId])

  function openEditContacts() {
    if (!family) return
    setEditContacts((family.contacts ?? []).length > 0
      ? (family.contacts ?? []).map(c => ({ name: c.name, phone: c.phone, dialCode: c.dialCode || '+242', relation: c.relation }))
      : [{ name: '', phone: '', dialCode: '+242', relation: '' }])
    setEditingContacts(true)
  }

  async function saveContacts() {
    if (!family || !familyId) return
    const valid = editContacts.filter(c => c.name.trim())
    setSavingContacts(true)
    await updateDoc(doc(db, 'families', familyId), { contacts: valid })
    setFamily(prev => prev ? { ...prev, contacts: valid } : prev)
    setEditingContacts(false)
    setSavingContacts(false)
  }

  async function assignStudent(studentId: string) {
    if (!familyId) return
    setAssigningStudent(studentId)
    await updateDoc(doc(db, 'students', studentId), { familyId })
    setAssigningStudent(null)
  }

  async function removeStudentFromFamily(studentId: string) {
    await updateDoc(doc(db, 'students', studentId), { familyId: null })
  }

  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]))
  const optionalFees = fees.filter((f) => !f.isDefault)
  const defaultFees = fees.filter((f) => f.isDefault)

  function familyFeeStatus(feeId: string): 'all' | 'some' | 'none' {
    const count = students.filter((s) => s.appliedFees.some((af) => af.feeId === feeId)).length
    if (count === 0) return 'none'
    if (count === students.length) return 'all'
    return 'some'
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!family) return null

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/dashboard/eleves" className="hover:text-[#00D1FF]">Élèves</Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">{family.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{family.name}</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{students.filter((s) => s.isActive).length}</span> actif(s)
            <span className="text-slate-300">·</span>
            <span className="font-medium text-slate-700">{students.length}</span> au total
          </div>
          <button
            onClick={() => { setStudentSearch(''); setShowStudentPicker(true) }}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold hover:bg-[#00b8e0] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter un élève
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Contacts */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900">Contacts</h2>
            {!editingContacts && (
              <button onClick={openEditContacts} className="text-xs text-[#00D1FF] hover:underline">
                {(family.contacts ?? []).length > 0 ? 'Modifier' : 'Ajouter'}
              </button>
            )}
          </div>
          {editingContacts ? (
            <div className="space-y-3">
              {editContacts.map((c, i) => (
                <div key={i} className="space-y-1.5 p-3 bg-slate-50 rounded-xl">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={c.name} onChange={e => setEditContacts(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      placeholder="Nom" className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                    <input value={c.relation} onChange={e => setEditContacts(prev => prev.map((x, j) => j === i ? { ...x, relation: e.target.value } : x))}
                      placeholder="Lien (père, mère…)" className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                  </div>
                  <div className="flex gap-1 items-center">
                    <PhoneInput
                      dialCode={c.dialCode || '+242'}
                      phone={c.phone}
                      onDialCodeChange={v => setEditContacts(prev => prev.map((x, j) => j === i ? { ...x, dialCode: v } : x))}
                      onPhoneChange={v => setEditContacts(prev => prev.map((x, j) => j === i ? { ...x, phone: v } : x))}
                      className="flex-1"
                    />
                    {editContacts.length > 1 && (
                      <button type="button" onClick={() => setEditContacts(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-400 px-1 text-lg leading-none">✕</button>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setEditContacts(prev => [...prev, { name: '', phone: '', dialCode: '+242', relation: '' }])}
                className="text-xs text-[#00D1FF] hover:underline">+ Ajouter un contact</button>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditingContacts(false)} className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 text-xs hover:bg-slate-50">Annuler</button>
                <button onClick={saveContacts} disabled={savingContacts} className="px-3 py-1.5 rounded-xl bg-[#00D1FF] text-white text-xs font-semibold hover:bg-[#00b8e0] disabled:opacity-60">
                  {savingContacts ? '…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          ) : (family.contacts ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">Aucun contact enregistré</p>
          ) : (
            <div className="space-y-3">
              {(family.contacts ?? []).map((c, i) => (
                <div key={i}>
                  <p className="text-sm font-medium text-slate-900">{c.name}</p>
                  {c.relation && <p className="text-xs text-slate-400">{c.relation}</p>}
                  {c.phone && <p className="text-xs text-[#00D1FF] mt-0.5 font-mono">{buildFullPhone(c.dialCode || '+242', c.phone)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Frais obligatoires famille */}
          {defaultFees.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-1">Frais obligatoires</h2>
              <p className="text-xs text-slate-400 mb-4">Appliquer une réduction sur la scolarité pour toute la famille</p>
              <div className="space-y-2">
                {defaultFees.map((fee) => (
                  <FamilyFeeToggle
                    key={fee.id}
                    fee={fee}
                    status="all"
                    isDefault
                    symbol={symbol}
                    students={students}
                    onApply={(reduction) => toggleFeeForFamily(fee.id, true, reduction)}
                    onRemove={() => { }}
                    onToggleForStudent={() => { }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Frais optionnels famille */}
          {optionalFees.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-1">Frais optionnels</h2>
              <p className="text-xs text-slate-400 mb-4">Appliquer à toute la famille d'un coup</p>
              <div className="space-y-2">
                {optionalFees.map((fee) => {
                  const status = familyFeeStatus(fee.id)
                  return (
                    <FamilyFeeToggle
                      key={fee.id}
                      fee={fee}
                      status={status}
                      isDefault={false}
                      symbol={symbol}
                      students={students}
                      onApply={(reduction) => toggleFeeForFamily(fee.id, true, reduction)}
                      onRemove={() => toggleFeeForFamily(fee.id, false)}
                      onToggleForStudent={(studentId) => toggleFeeForStudent(studentId, fee.id)}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Students detail */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900">Détail par élève</h2>
        {students.length === 0 && (
          <p className="text-slate-400 text-sm">Aucun élève dans cette famille.</p>
        )}
        {students.map((student) => {
          const appliedMap = Object.fromEntries(student.appliedFees.map((af) => [af.feeId, af]))
          const totalMonthly = fees
            .filter((f) => appliedMap[f.id] || f.isDefault)
            .reduce((sum, f) => {
              const af = appliedMap[f.id] ?? { feeId: f.id, reduction: 0 }
              return sum + f.monthlyAmount - (af.reduction || 0)
            }, 0)

          return (
            <div key={student.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${student.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
                    }`}>
                    {student.firstName[0]}{student.lastName[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{student.firstName} {student.lastName}</p>
                    <p className="text-xs text-slate-500">{classMap[student.classId] || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{fmt(totalMonthly)}/mois</p>
                    <p className="text-xs text-slate-400">{student.appliedFees.length} frais</p>
                  </div>
                  <button
                    onClick={() => { if (window.confirm(`Retirer ${student.firstName} ${student.lastName} de cette famille ?`)) removeStudentFromFamily(student.id) }}
                    className="text-xs text-red-400 hover:text-red-600 font-medium border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 transition-colors"
                  >
                    Retirer
                  </button>
                  <Link href={`/dashboard/eleves/${student.id}`} className="text-xs text-[#00D1FF] font-medium hover:underline ml-2">
                    Fiche →
                  </Link>
                </div>
              </div>

              <div className="px-5 py-3 space-y-2">
                {defaultFees.map((fee) => {
                  const af = appliedMap[fee.id] ?? { feeId: fee.id, reduction: 0 }
                  return (
                    <StudentFeeRow
                      key={fee.id}
                      fee={fee}
                      appliedFee={af}
                      isDefault
                      symbol={symbol}
                      onToggle={() => { }}
                      onReductionChange={(r) => updateStudentReduction(student.id, fee.id, r)}
                    />
                  )
                })}
                {optionalFees.map((fee) => {
                  const af = appliedMap[fee.id]
                  return (
                    <StudentFeeRow
                      key={fee.id}
                      fee={fee}
                      appliedFee={af}
                      isDefault={false}
                      symbol={symbol}
                      onToggle={() => toggleFeeForStudent(student.id, fee.id)}
                      onReductionChange={(r) => updateStudentReduction(student.id, fee.id, r)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {/* Student picker modal */}
      {showStudentPicker && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-sm w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">Ajouter un élève à la famille</h2>
              <button onClick={() => setShowStudentPicker(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 border-b border-slate-100">
              <input
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                placeholder="Rechercher un élève…"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>

            <div className="overflow-y-auto flex-1 p-2">
              {(() => {
                const alreadyInThisFamily = new Set(students.map(s => s.id))
                const filtered = allStudents.filter(s => {
                  const fullName = `${s.firstName} ${s.lastName}`.toLowerCase()
                  return fullName.includes(studentSearch.toLowerCase())
                }).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))

                if (filtered.length === 0) return (
                  <p className="text-sm text-slate-400 text-center py-6">Aucun élève trouvé</p>
                )

                return filtered.map(s => {
                  const inThisFamily = alreadyInThisFamily.has(s.id)
                  const inOtherFamily = !inThisFamily && !!s.familyId
                  const otherFamName = inOtherFamily ? (familyNames[s.familyId!] ?? '…') : null
                  const isAssigning = assigningStudent === s.id

                  return (
                    <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${inThisFamily ? 'bg-[#00D1FF]/5' : inOtherFamily ? 'opacity-50' : 'hover:bg-slate-50'}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                        {s.firstName[0]}{s.lastName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{s.firstName} {s.lastName}</p>
                        {inThisFamily && <p className="text-xs text-[#00D1FF]">Déjà dans cette famille</p>}
                        {inOtherFamily && <p className="text-xs text-slate-400">Famille : {otherFamName}</p>}
                        {!inThisFamily && !inOtherFamily && classMap[s.classId] && (
                          <p className="text-xs text-slate-400">{classMap[s.classId]}</p>
                        )}
                      </div>
                      {inThisFamily ? (
                        <span className="text-xs text-[#00D1FF] font-medium flex-shrink-0">✓</span>
                      ) : inOtherFamily ? (
                        <span className="text-xs text-slate-300 flex-shrink-0">Indisponible</span>
                      ) : (
                        <button
                          onClick={() => assignStudent(s.id)}
                          disabled={!!assigningStudent}
                          className="text-xs px-3 py-1.5 bg-[#00D1FF]/10 text-[#00D1FF] font-semibold rounded-lg hover:bg-[#00D1FF]/20 disabled:opacity-50 transition-colors flex-shrink-0"
                        >
                          {isAssigning ? '…' : 'Ajouter'}
                        </button>
                      )}
                    </div>
                  )
                })
              })()}
            </div>

            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setShowStudentPicker(false)} className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FamilyFeeToggle({
  fee, status, symbol, students, onApply, onRemove, onToggleForStudent, isDefault = false,
}: {
  fee: Fee
  status: 'all' | 'some' | 'none'
  isDefault?: boolean
  symbol: string
  students: Student[]
  onApply: (reduction: number) => void
  onRemove: () => void
  onToggleForStudent: (studentId: string) => void
}) {
  const [reduction, setReduction] = useState('')
  const [editingReduction, setEditingReduction] = useState(false)
  const [showPartialModal, setShowPartialModal] = useState(false)
  const isActive = status !== 'none'

  function applyReduction() {
    const r = Math.max(0, Math.min(parseFloat(reduction) || 0, fee.monthlyAmount))
    setReduction(String(r))
    onApply(r)
    setEditingReduction(false)
  }

  function handleToggle() {
    if (isDefault) return
    if (isActive) {
      onRemove()
    } else {
      onApply(parseFloat(reduction) || 0)
    }
  }

  return (
    <>
      <div className={`rounded-xl border p-3 transition-all ${status === 'all' ? 'border-[#00D1FF]/30 bg-[#00D1FF]/5'
          : status === 'some' ? 'border-amber-200 bg-amber-50'
            : 'border-slate-100 bg-slate-50'
        }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!isDefault && (
              <button type="button" onClick={handleToggle}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${status === 'all' ? 'bg-[#00D1FF] border-[#00D1FF]'
                    : status === 'some' ? 'bg-amber-400 border-amber-400'
                      : 'border-slate-300'
                  }`}>
                  {status === 'all' && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {status === 'some' && <span className="text-white text-xs font-bold">~</span>}
                </div>
              </button>
            )}
            <div>
              <p className="text-sm font-medium text-slate-900">{fee.name}</p>
              <p className="text-xs text-slate-500">{fee.monthlyAmount.toLocaleString('fr-FR')} {symbol}/mois</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isDefault && status === 'none' && (
              <button
                onClick={() => onApply(parseFloat(reduction) || 0)}
                className="text-xs text-[#00D1FF] font-medium hover:underline"
              >
                Appliquer à tous
              </button>
            )}
            {!isDefault && status === 'some' && (
              <button
                onClick={() => setShowPartialModal(true)}
                className="text-xs text-amber-600 font-medium border border-amber-300 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-lg transition-colors"
              >
                Partiel — gérer
              </button>
            )}
          </div>
        </div>

        {isActive && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-500">Réduction pour tous :</span>
            {editingReduction ? (
              <>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max={fee.monthlyAmount}
                    step="0.01"
                    value={reduction}
                    onChange={(e) => setReduction(e.target.value)}
                    className="w-24 px-2 py-1 pr-12 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyReduction()
                      if (e.key === 'Escape') setEditingReduction(false)
                    }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{symbol}</span>
                </div>
                <button
                  onClick={applyReduction}
                  className="text-xs text-[#00D1FF] font-semibold hover:underline px-1"
                >OK</button>
                <button onClick={() => setEditingReduction(false)} className="text-xs text-slate-400 px-1">✕</button>
              </>
            ) : (
              <button
                onClick={() => setEditingReduction(true)}
                className={`text-xs px-2 py-0.5 rounded-lg border transition-colors ${parseFloat(reduction) > 0
                    ? 'border-emerald-200 text-emerald-600 bg-emerald-50'
                    : 'border-slate-200 text-slate-500 hover:bg-white'
                  }`}
              >
                {parseFloat(reduction) > 0 ? `- ${reduction} ${symbol}` : '0 — modifier'}
              </button>
            )}
          </div>
        )}
      </div>

      {showPartialModal && (
        <PartialFeeModal
          fee={fee}
          students={students}
          symbol={symbol}
          onToggle={onToggleForStudent}
          onApplyAll={() => { onApply(parseFloat(reduction) || 0); setShowPartialModal(false) }}
          onRemoveAll={() => { onRemove(); setShowPartialModal(false) }}
          onClose={() => setShowPartialModal(false)}
        />
      )}
    </>
  )
}

function PartialFeeModal({
  fee, students, symbol, onToggle, onApplyAll, onRemoveAll, onClose,
}: {
  fee: Fee
  students: Student[]
  symbol: string
  onToggle: (studentId: string) => void
  onApplyAll: () => void
  onRemoveAll: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-slate-900">{fee.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">Sélectionnez les élèves qui bénéficient de ce frais</p>

        <div className="space-y-2 mb-5">
          {students.map((student) => {
            const has = student.appliedFees.some((af) => af.feeId === fee.id)
            return (
              <button
                key={student.id}
                type="button"
                onClick={() => onToggle(student.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${has ? 'border-[#00D1FF]/30 bg-[#00D1FF]/5' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'
                  }`}
              >
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${has ? 'bg-[#00D1FF] border-[#00D1FF]' : 'border-slate-300'
                  }`}>
                  {has && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${student.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                  {student.firstName[0]}{student.lastName[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{student.firstName} {student.lastName}</p>
                  {!student.isActive && <p className="text-xs text-slate-400">Inactif</p>}
                </div>
                {has && (
                  <span className="text-xs text-[#00D1FF] font-medium flex-shrink-0">
                    {fee.monthlyAmount.toLocaleString('fr-FR')} {symbol}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex gap-3 border-t border-slate-100 pt-4">
          <button
            onClick={onRemoveAll}
            className="flex-1 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Retirer de tous
          </button>
          <button
            onClick={onApplyAll}
            className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] transition-colors"
          >
            Appliquer à tous
          </button>
        </div>
      </div>
    </div>
  )
}

function StudentFeeRow({
  fee, appliedFee, isDefault, symbol, onToggle, onReductionChange,
}: {
  fee: Fee
  appliedFee: { feeId: string; reduction: number } | undefined
  isDefault: boolean
  symbol: string
  onToggle: () => void
  onReductionChange: (r: number) => void
}) {
  const isApplied = !!appliedFee
  const reduction = appliedFee?.reduction ?? 0
  const net = fee.monthlyAmount - reduction

  const [editing, setEditing] = useState(false)
  const [tempVal, setTempVal] = useState(String(reduction))

  useEffect(() => {
    if (!editing) setTempVal(String(reduction))
  }, [reduction, editing])

  function save() {
    const r = Math.max(0, Math.min(parseFloat(tempVal) || 0, fee.monthlyAmount))
    onReductionChange(r)
    setEditing(false)
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${isApplied ? 'bg-slate-50' : 'opacity-40'
      }`}>
      {!isDefault && (
        <button type="button" onClick={onToggle} className="flex-shrink-0">
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${isApplied ? 'bg-[#00D1FF] border-[#00D1FF]' : 'border-slate-300'
            }`}>
            {isApplied && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </button>
      )}
      {isDefault && <div className="w-4 flex-shrink-0" />}

      <p className="text-sm text-slate-700 flex-1">{fee.name}</p>

      {isApplied && (
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max={fee.monthlyAmount}
                  step="0.01"
                  value={tempVal}
                  onChange={(e) => setTempVal(e.target.value)}
                  className="w-20 px-2 py-1 pr-10 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#00D1FF]"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{symbol}</span>
              </div>
              <button onClick={save} className="text-xs text-[#00D1FF] font-semibold hover:underline">OK</button>
              <button onClick={() => setEditing(false)} className="text-xs text-slate-400">✕</button>
            </>
          ) : (
            <>
              {reduction > 0 && (
                <span className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-lg">
                  -{reduction.toLocaleString('fr-FR')} {symbol}
                </span>
              )}
              <span className="text-sm font-semibold text-slate-900 min-w-[70px] text-right">
                {net.toLocaleString('fr-FR')} {symbol}
              </span>
              <button
                onClick={() => { setTempVal(String(reduction)); setEditing(true) }}
                className="text-xs text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-white transition-colors"
                title="Modifier la réduction"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}