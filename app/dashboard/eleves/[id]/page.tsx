'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, getDoc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { useCurrency } from '../../../_lib/currency-context'
import { Student, SchoolClass, Family, Fee } from '../../../_lib/types'
import PhoneInput, { buildFullPhone } from '../../../_components/PhoneInput'

export default function StudentPage({ params }: PageProps<'/dashboard/eleves/[id]'>) {
  const router = useRouter()
  const { uid } = useSchoolYear()
  const { symbol } = useCurrency()
  const [student, setStudent] = useState<Student | null>(null)
  const [cls, setCls] = useState<SchoolClass | null>(null)
  const [family, setFamily] = useState<Family | null>(null)
  const [allFees, setAllFees] = useState<Fee[]>([])
  const [allFamilies, setAllFamilies] = useState<Family[]>([])
  const [allClasses, setAllClasses] = useState<SchoolClass[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [showFamilyPicker, setShowFamilyPicker] = useState(false)
  const [pickerFamilyId, setPickerFamilyId] = useState('')
  const [familySearch, setFamilySearch] = useState('')
  const [savingFamily, setSavingFamily] = useState(false)
  const [editingContacts, setEditingContacts] = useState(false)
  const [editContacts, setEditContacts] = useState<Array<{name:string;phone:string;dialCode:string;relation:string}>>([])
  const [savingContacts, setSavingContacts] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editGender, setEditGender] = useState<'M' | 'F'>('M')
  const [editClassId, setEditClassId] = useState('')
  const [editBirthDate, setEditBirthDate] = useState('')
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    let unsubStudent: (() => void) | undefined

    params.then(async ({ id }) => {
      unsubStudent = onSnapshot(doc(db, 'students', id), async (snap) => {
        if (!snap.exists()) { router.push('/dashboard/eleves'); return }
        const s = { id: snap.id, ...snap.data() } as Student
        setStudent(s)
        setLoading(false)

        const feesSnap = await getDocs(query(collection(db, 'fees'), where('schoolYearId', '==', s.schoolYearId), ...(uid ? [where('userId', '==', uid)] : [])))
        setAllFees(feesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Fee)))

        const classesSnap = await getDocs(query(collection(db, 'classes'), where('schoolYearId', '==', s.schoolYearId), ...(uid ? [where('userId', '==', uid)] : [])))
        setAllClasses(classesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolClass)))

        if (s.classId) {
          const clsSnap = await getDoc(doc(db, 'classes', s.classId))
          if (clsSnap.exists()) setCls({ id: clsSnap.id, ...clsSnap.data() } as SchoolClass)
        }

        const famsSnap = await getDocs(query(collection(db, 'families'), where('schoolYearId', '==', s.schoolYearId), ...(uid ? [where('userId', '==', uid)] : [])))
        setAllFamilies(famsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Family)))

        if (s.familyId) {
          const famSnap = await getDoc(doc(db, 'families', s.familyId))
          if (famSnap.exists()) setFamily({ id: famSnap.id, ...famSnap.data() } as Family)
          else setFamily(null)
        } else {
          setFamily(null)
        }
      })
    })

    return () => unsubStudent?.()
  }, [])

  function openEdit() {
    if (!student) return
    setEditFirstName(student.firstName)
    setEditLastName(student.lastName)
    setEditGender(student.gender as 'M' | 'F')
    setEditClassId(student.classId)
    setEditBirthDate(student.birthDate || '')
    setEditError('')
    setEditing(true)
  }

  async function saveEdit() {
    if (!student) return
    if (!editFirstName.trim() || !editLastName.trim()) { setEditError('Le prénom et le nom sont requis.'); return }
    if (!editClassId) { setEditError('La classe est obligatoire.'); return }
    setSavingEdit(true)
    setEditing(false)
    try {
      await updateDoc(doc(db, 'students', student.id), {
        firstName: editFirstName.trim(),
        lastName: editLastName.trim(),
        gender: editGender,
        classId: editClassId,
        birthDate: editBirthDate || null,
      })
    } catch {
      setEditError('Erreur lors de la sauvegarde.')
      setEditing(true)
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleFee(feeId: string) {
    if (!student) return
    const has = student.appliedFees.some((af) => af.feeId === feeId)
    const updated = has
      ? student.appliedFees.filter((af) => af.feeId !== feeId)
      : [...student.appliedFees, { feeId, reduction: 0 }]
    setStudent({ ...student, appliedFees: updated })
    await updateDoc(doc(db, 'students', student.id), { appliedFees: updated })
  }

  async function updateReduction(feeId: string, reduction: number) {
    if (!student) return
    const has = student.appliedFees.some((af) => af.feeId === feeId)
    const updated = has
      ? student.appliedFees.map((af) => af.feeId === feeId ? { ...af, reduction } : af)
      : [...student.appliedFees, { feeId, reduction }]
    setStudent({ ...student, appliedFees: updated })
    await updateDoc(doc(db, 'students', student.id), { appliedFees: updated })
  }

  async function toggleActive() {
    if (!student || toggling) return
    const next = !student.isActive
    setStudent({ ...student, isActive: next })
    setToggling(true)
    try {
      await updateDoc(doc(db, 'students', student.id), { isActive: next })
    } finally {
      setToggling(false)
    }
  }

  async function removeFromFamily() {
    if (!student) return
    setSavingFamily(true)
    try {
      await updateDoc(doc(db, 'students', student.id), { familyId: null })
    } finally {
      setSavingFamily(false)
    }
  }

  async function assignFamily() {
    if (!student) return
    const newFamilyId = pickerFamilyId || null
    setShowFamilyPicker(false)
    setFamilySearch('')
    setSavingFamily(true)
    try {
      await updateDoc(doc(db, 'students', student.id), { familyId: newFamilyId })
    } finally {
      setSavingFamily(false)
    }
  }

  function openEditContacts() {
    if (!student) return
    setEditContacts((student.contacts ?? []).length > 0
      ? student.contacts!.map(c => ({ name: c.name, phone: c.phone, dialCode: c.dialCode || '+242', relation: c.relation }))
      : [{ name: '', phone: '', dialCode: '+242', relation: '' }]
    )
    setEditingContacts(true)
  }

  async function saveContacts() {
    if (!student) return
    const valid = editContacts.filter(c => c.name.trim() || c.phone.trim())
    setSavingContacts(true)
    setEditingContacts(false)
    try {
      await updateDoc(doc(db, 'students', student.id), { contacts: valid })
    } finally {
      setSavingContacts(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!student) return null

  const optionalFees = allFees.filter((f) => !f.isDefault)
  const defaultFees = allFees.filter((f) => f.isDefault)
  const appliedMap = Object.fromEntries(student.appliedFees.map((af) => [af.feeId, af]))

  function getAge() {
    if (!student?.birthDate) return null
    const diff = Date.now() - new Date(student.birthDate).getTime()
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25))
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/dashboard/eleves" className="hover:text-[#00D1FF] transition-colors">Élèves</Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">{student.firstName} {student.lastName}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold transition-all ${student.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
            }`}>
            {student.firstName[0]}{student.lastName[0]}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{student.firstName} {student.lastName}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-slate-500">{cls?.name || '—'}</span>
              <span className="text-slate-300">·</span>
              <span className="text-sm text-slate-500">{student.gender === 'M' ? 'Garçon' : 'Fille'}</span>
              {getAge() !== null && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-sm text-slate-500">{getAge()} ans</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full transition-all ${student.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
            }`}>
            {student.isActive && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />}
            {student.isActive ? 'Actif' : 'Inactif'}
          </span>
          <button
            onClick={toggleActive}
            disabled={toggling}
            className={`text-xs px-3 py-1.5 rounded-xl border transition-all ${toggling
                ? 'opacity-50 cursor-not-allowed border-slate-200 text-slate-400'
                : student.isActive
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
              }`}
          >
            {toggling ? '…' : student.isActive ? 'Désactiver' : 'Réactiver'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900">Informations</h2>
            {!editing && (
              <button onClick={openEdit} className="text-xs text-[#00D1FF] hover:underline">
                Modifier
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Prénom *</label>
                  <input
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nom *</label>
                  <input
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sexe *</label>
                <div className="flex gap-2">
                  {(['M', 'F'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setEditGender(g)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${editGender === g
                          ? 'border-[#00D1FF] bg-[#00D1FF]/10 text-[#00D1FF]'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                      {g === 'M' ? 'Garçon' : 'Fille'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Classe *</label>
                <select
                  value={editClassId}
                  onChange={(e) => setEditClassId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                >
                  <option value="">— Choisir —</option>
                  {allClasses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date de naissance</label>
                <input
                  type="date"
                  value={editBirthDate}
                  onChange={(e) => setEditBirthDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                />
              </div>

              {editError && <p className="text-xs text-red-500">{editError}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setEditing(false); setEditError('') }}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="flex-1 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] disabled:opacity-60"
                >
                  {savingEdit ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          ) : (
            <dl className="space-y-3">
              <InfoRow label="Prénom" value={student.firstName} />
              <InfoRow label="Nom" value={student.lastName} />
              <InfoRow label="Sexe" value={student.gender === 'M' ? 'Garçon' : 'Fille'} />
              <InfoRow label="Classe" value={cls?.name || '—'} />
              {student.birthDate && (
                <InfoRow label="Né(e) le" value={new Date(student.birthDate).toLocaleDateString('fr-FR')} />
              )}
            </dl>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900">Famille</h2>
            {!showFamilyPicker && (
              <div className="flex items-center gap-3">
                {student.familyId && (
                  <button
                    onClick={removeFromFamily}
                    disabled={savingFamily}
                    className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-50 transition-colors"
                  >
                    Retirer
                  </button>
                )}
                <button
                  onClick={() => { setPickerFamilyId(student.familyId || ''); setShowFamilyPicker(true) }}
                  className="text-xs text-[#00D1FF] hover:underline"
                >
                  {student.familyId ? 'Changer' : 'Assigner'}
                </button>
              </div>
            )}
          </div>

          {showFamilyPicker ? (
            <div className="space-y-2">
              <input
                value={familySearch}
                onChange={(e) => { setFamilySearch(e.target.value); setPickerFamilyId('') }}
                placeholder="Rechercher une famille…"
                autoFocus
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                <button type="button" onClick={() => setPickerFamilyId('')}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${!pickerFamilyId ? 'bg-[#00D1FF]/10 text-[#00D1FF] font-medium' : 'text-slate-400 hover:bg-slate-50'}`}>
                  — Aucune famille —
                </button>
                {allFamilies.filter(f => f.name.toLowerCase().includes(familySearch.toLowerCase())).map((f) => (
                  <button key={f.id} type="button" onClick={() => setPickerFamilyId(f.id)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${pickerFamilyId === f.id ? 'bg-[#00D1FF]/10 text-[#00D1FF] font-medium' : 'hover:bg-slate-50 text-slate-700'}`}>
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowFamilyPicker(false); setFamilySearch('') }}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 text-xs hover:bg-slate-50">Annuler</button>
                <button onClick={assignFamily} disabled={savingFamily}
                  className="px-3 py-1.5 rounded-xl bg-[#00D1FF] text-white text-xs font-semibold hover:bg-[#00b8e0] disabled:opacity-60">
                  {savingFamily ? '…' : 'Valider'}
                </button>
              </div>
            </div>
          ) : family ? (
            <div>
              <Link href={`/dashboard/eleves/famille/${family.id}`} className="font-semibold text-[#00D1FF] hover:underline">
                {family.name}
              </Link>
              {family.contacts.length > 0 && (
                <div className="mt-3 space-y-2">
                  {family.contacts.map((c, i) => (
                    <div key={i} className="text-sm text-slate-600">
                      <span className="font-medium">{c.name}</span>
                      {c.relation && <span className="text-slate-400"> ({c.relation})</span>}
                      {c.phone && <span className="ml-2 text-slate-500">{c.phone}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Pas de famille associée</p>
          )}
        </div>
      </div>

      {/* Contacts / Tuteurs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-900">Tuteurs / Contacts</h2>
          {!editingContacts && (
            <button onClick={openEditContacts} className="text-xs text-[#00D1FF] hover:underline">
              {(student.contacts ?? []).length > 0 ? 'Modifier' : 'Ajouter'}
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
        ) : (student.contacts ?? []).length > 0 ? (
          <div className="space-y-2">
            {student.contacts!.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-slate-700">
                <span className="font-medium">{c.name}</span>
                {c.relation && <span className="text-slate-400 text-xs">({c.relation})</span>}
                {c.phone && (
                  <span className="text-slate-500 font-mono text-xs bg-slate-50 px-2 py-0.5 rounded-lg">
                    {buildFullPhone(c.dialCode || '+242', c.phone)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Aucun tuteur renseigné</p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 mt-4">
        <h2 className="text-sm font-bold text-slate-900 mb-4">Frais</h2>

        {defaultFees.length > 0 && (
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Obligatoires</p>
            {defaultFees.map((fee) => {
              // ← CORRECTION : force isApplied=true pour les frais obligatoires
              const af = appliedMap[fee.id] ?? { feeId: fee.id, reduction: 0 }
              return (
                <FeeRow
                  key={fee.id}
                  fee={fee}
                  appliedFee={af}
                  isDefault
                  symbol={symbol}
                  onReductionChange={(r) => updateReduction(fee.id, r)}
                />
              )
            })}
          </div>
        )}

        {optionalFees.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Optionnels</p>
            {optionalFees.map((fee) => {
              const af = appliedMap[fee.id]
              return (
                <FeeRow
                  key={fee.id}
                  fee={fee}
                  appliedFee={af}
                  isDefault={false}
                  symbol={symbol}
                  onToggle={() => toggleFee(fee.id)}
                  onReductionChange={(r) => updateReduction(fee.id, r)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  )
}

function FeeRow({
  fee, appliedFee, isDefault, symbol, onToggle, onReductionChange,
}: {
  fee: Fee
  appliedFee: { feeId: string; reduction: number } | undefined
  isDefault: boolean
  symbol: string
  onToggle?: () => void
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

  function saveReduction() {
    const r = Math.max(0, Math.min(parseFloat(tempVal) || 0, fee.monthlyAmount))
    onReductionChange(r)
    setEditing(false)
  }

  function startEdit() {
    setTempVal(String(reduction))
    setEditing(true)
  }

  return (
    <div className={`rounded-xl border p-3 transition-all ${isApplied ? 'border-slate-100 bg-slate-50' : 'border-dashed border-slate-200'
      }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isDefault && (
            <button type="button" onClick={onToggle} className="flex-shrink-0">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isApplied ? 'bg-[#00D1FF] border-[#00D1FF]' : 'border-slate-300'
                }`}>
                {isApplied && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          )}
          <p className={`text-sm font-medium ${isApplied ? 'text-slate-900' : 'text-slate-400'}`}>{fee.name}</p>
        </div>

        {isApplied && (
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-900">
              {net.toLocaleString('fr-FR')} {symbol}
            </p>
            {reduction > 0 && (
              <p className="text-xs text-slate-400 line-through">
                {fee.monthlyAmount.toLocaleString('fr-FR')} {symbol}
              </p>
            )}
          </div>
        )}
      </div>

      {isApplied && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-slate-500">Réduction :</span>
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
                  className="w-24 px-2 py-1 pr-12 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') saveReduction(); if (e.key === 'Escape') setEditing(false) }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{symbol}</span>
              </div>
              <button onClick={saveReduction} className="text-xs font-semibold text-[#00D1FF] hover:underline px-1">OK</button>
              <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600 px-1">✕</button>
            </>
          ) : (
            <button
              onClick={startEdit}
              className={`text-xs px-2 py-0.5 rounded-lg border transition-colors ${reduction > 0
                  ? 'border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                  : 'border-slate-200 text-slate-500 hover:bg-white'
                }`}
            >
              {reduction > 0 ? `- ${reduction.toLocaleString('fr-FR')} ${symbol}` : '0 — cliquer pour modifier'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}