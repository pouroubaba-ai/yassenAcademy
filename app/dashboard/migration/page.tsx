'use client'

import { useState, useEffect } from 'react'
import { collection, doc, setDoc, getDocs, query, where, writeBatch, updateDoc, addDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import Link from 'next/link'

interface MigrationStudent {
  id: string
  firstName: string
  lastName: string
  className: string
  gender: string
  family: string | null
  status: 'pending' | 'present' | 'absent' | 'gone' | 'new'
  familyConfirmed: boolean | null
  bus: boolean
  canteen: boolean
  addedManually: boolean
  sessionId: string
}

interface ClassSession {
  id: string
  className: string
  code: string
  status: 'not_started' | 'in_progress' | 'done'
  total: number
  done: number
  present: number
  absent: number
  gone: number
  newStudents: number
}

interface MigrationFamily {
  name: string
  students: MigrationStudent[]
}

function generateCode(className: string) {
  const clean = className.replace(/\s+/g, '').toUpperCase().slice(0, 4)
  const num = Math.floor(1000 + Math.random() * 9000)
  return `${clean}${num}`
}

export default function MigrationPage() {
  const { uid, activeYear } = useSchoolYear()
  const [mainTab, setMainTab] = useState<'classes' | 'familles'>('classes')
  const [sessions, setSessions] = useState<ClassSession[]>([])
  const [allStudents, setAllStudents] = useState<MigrationStudent[]>([])
  const [families, setFamilies] = useState<MigrationFamily[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)
  const [error, setError] = useState('')
  const [showCodes, setShowCodes] = useState(false)
  const [classFilter, setClassFilter] = useState<'all' | 'not_started' | 'in_progress' | 'done' | 'admin_reviewed' | 'to_review' | 'absent' | 'gone' | 'new' | 'claiming' | 'contesting'>('all')

  // Familles state
  const [familySearch, setFamilySearch] = useState('')
  const [selectedFamily, setSelectedFamily] = useState<MigrationFamily | null>(null)
  const [showNewFamily, setShowNewFamily] = useState(false)
  const [newFamilyName, setNewFamilyName] = useState('')
  const [savingFamily, setSavingFamily] = useState(false)
  const [showAddStudentToFamily, setShowAddStudentToFamily] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')

  // Frais de migration
  const [scolariteFee, setScolariteFee] = useState('')
  const [grandBusFee, setGrandBusFee] = useState('')
  const [petitBusFee, setPetitBusFee] = useState('')
  const [canteenFee, setCanteenFee] = useState('')
  const [savingFees, setSavingFees] = useState(false)
  const [feesSaved, setFeesSaved] = useState(false)

  // Export
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportDone, setExportDone] = useState(false)
  const [exportError, setExportError] = useState('')
  const [collapsedGone, setCollapsedGone] = useState(true)

  useEffect(() => {
    if (!uid) return
    loadData()
  }, [uid])

  async function loadData() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'migrationSessions'), where('uid', '==', uid)))
      if (snap.empty) { setSessions([]); setImported(false); setLoading(false); return }

      const sess: ClassSession[] = []
      const studs: MigrationStudent[] = []

      for (const d of snap.docs) {
        const data = d.data()
        const studSnap = await getDocs(collection(db, 'migrationSessions', d.id, 'students'))
        const classStuds = studSnap.docs.map(s => ({ id: s.id, sessionId: d.id, ...s.data() } as MigrationStudent))
        studs.push(...classStuds)

        const total = classStuds.length
        const done = classStuds.filter(s => s.status !== 'pending').length
        sess.push({
          id: d.id,
          className: data.className,
          code: data.code,
          status: done === 0 ? 'not_started' : done === total ? 'done' : 'in_progress',
          total, done,
          present: classStuds.filter(s => s.status === 'present').length,
          absent: classStuds.filter(s => s.status === 'absent').length,
          gone: classStuds.filter(s => s.status === 'gone').length,
          newStudents: classStuds.filter(s => s.status === 'new' || s.addedManually).length,
        })
      }

      sess.sort((a, b) => a.className.localeCompare(b.className))
      setSessions(sess)
      setAllStudents(studs)

      // Charger les frais depuis la première session
      const firstData = snap.docs[0].data()
      if (firstData.scolariteFee) setScolariteFee(String(firstData.scolariteFee))
      if (firstData.grandBusFee) setGrandBusFee(String(firstData.grandBusFee))
      if (firstData.petitBusFee) setPetitBusFee(String(firstData.petitBusFee))
      if (firstData.canteenFee) setCanteenFee(String(firstData.canteenFee))

      // Construire familles
      buildFamilies(studs)
      setImported(true)
    } catch (e) {
      setError('Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  function buildFamilies(studs: MigrationStudent[]) {
    const map: Record<string, MigrationStudent[]> = {}
    studs.forEach(s => {
      const key = s.family?.trim() || ''
      if (key) {
        if (!map[key]) map[key] = []
        map[key].push(s)
      }
    })
    const fams = Object.entries(map).map(([name, students]) => ({ name, students }))
    fams.sort((a, b) => a.name.localeCompare(b.name))
    setFamilies(fams)
  }

  async function saveFees() {
    setSavingFees(true)
    const snap = await getDocs(query(collection(db, 'migrationSessions'), where('uid', '==', uid)))
    await Promise.all(snap.docs.map(d => updateDoc(doc(db, 'migrationSessions', d.id), {
      scolariteFee: Number(scolariteFee) || 0,
      grandBusFee: Number(grandBusFee) || 0,
      petitBusFee: Number(petitBusFee) || 0,
      canteenFee: Number(canteenFee) || 0,
    })))
    setFeesSaved(true)
    setTimeout(() => setFeesSaved(false), 3000)
    setSavingFees(false)
  }

  async function runExport() {
    if (!uid || !activeYear) { setExportError('Aucune année scolaire active trouvée.'); return }
    setExporting(true)
    setExportError('')
    try {
      // Load all sessions + students
      const sessionsSnap = await getDocs(query(collection(db, 'migrationSessions'), where('uid', '==', uid)))
      if (sessionsSnap.empty) throw new Error('Aucune session trouvée.')
      const firstData = sessionsSnap.docs[0].data()
      const schoolFeeAmt = Number(firstData.scolariteFee) || 0
      const gbFeeAmt = Number(firstData.grandBusFee) || 0
      const pbFeeAmt = Number(firstData.petitBusFee) || 0
      const ctFeeAmt = Number(firstData.canteenFee) || 0

      const rawStudents: any[] = []
      await Promise.all(sessionsSnap.docs.map(async sd => {
        const sSnap = await getDocs(collection(db, 'migrationSessions', sd.id, 'students'))
        sSnap.docs.forEach(d => rawStudents.push({ ...d.data(), id: d.id, sessionId: sd.id, className: sd.data().className }))
      }))

      // Only export present / new / absent (not gone)
      const toExport = rawStudents.filter(s => s.status !== 'gone')
      const schoolYearId = activeYear.id

      // 1. Create fees
      const schoolFeeRef = await addDoc(collection(db, 'fees'), { name: 'Scolarité', monthlyAmount: schoolFeeAmt, isDefault: true, schoolYearId, userId: uid })
      const feeIds: Record<string, string> = { school: schoolFeeRef.id }
      if (gbFeeAmt > 0) { const r = await addDoc(collection(db, 'fees'), { name: 'Grand Bus', monthlyAmount: gbFeeAmt, isDefault: false, schoolYearId, userId: uid }); feeIds.grandBus = r.id }
      if (pbFeeAmt > 0) { const r = await addDoc(collection(db, 'fees'), { name: 'Petit Bus', monthlyAmount: pbFeeAmt, isDefault: false, schoolYearId, userId: uid }); feeIds.petitBus = r.id }
      if (ctFeeAmt > 0) { const r = await addDoc(collection(db, 'fees'), { name: 'Cantine', monthlyAmount: ctFeeAmt, isDefault: false, schoolYearId, userId: uid }); feeIds.canteen = r.id }

      // 2. Create classes
      const classNames = [...new Set(sessionsSnap.docs.map(d => d.data().className as string))]
      const classIds: Record<string, string> = {}
      for (const cn of classNames) {
        const r = await addDoc(collection(db, 'classes'), { name: cn, schoolYearId, userId: uid })
        classIds[cn] = r.id
      }

      // 3. Create families
      const familyIds: Record<string, string> = {}
      const familyNames = [...new Set(toExport.filter(s => s.family).map(s => s.family as string))]
      for (const fn of familyNames) {
        const rep = toExport.find(s => s.family === fn)
        const rawPhone = rep?.phone || rep?.phoneManuel || null
        const phone = rawPhone ? rawPhone.replace(/^\+242/, '') : ''
        const contacts = phone ? [{ name: fn, phone, dialCode: '+242', relation: 'Tuteur' }] : []
        const r = await addDoc(collection(db, 'families'), { name: fn, contacts, schoolYearId, userId: uid })
        familyIds[fn] = r.id
      }

      // 4. School year months
      const MONTHS = [
        { month: 10, year: 2025, value: '2025-10' },
        { month: 11, year: 2025, value: '2025-11' },
        { month: 12, year: 2025, value: '2025-12' },
        { month: 1, year: 2026, value: '2026-01' },
        { month: 2, year: 2026, value: '2026-02' },
        { month: 3, year: 2026, value: '2026-03' },
        { month: 4, year: 2026, value: '2026-04' },
        { month: 5, year: 2026, value: '2026-05' },
        { month: 6, year: 2026, value: '2026-06' },
        { month: 7, year: 2026, value: '2026-07' },
      ]

      // 5. Create students + monthly entries
      for (const s of toExport) {
        const schoolRed = s.schoolReduction ?? 0
        const busRed = s.busReduction ?? 0
        const ctRed = s.canteenReduction ?? 0
        const appliedFees: { feeId: string; reduction: number }[] = [
          { feeId: feeIds.school, reduction: schoolRed },
        ]
        if (s.grandBus && feeIds.grandBus) appliedFees.push({ feeId: feeIds.grandBus, reduction: busRed })
        if (s.petitBus && feeIds.petitBus) appliedFees.push({ feeId: feeIds.petitBus, reduction: busRed })
        if (s.canteen && feeIds.canteen) appliedFees.push({ feeId: feeIds.canteen, reduction: ctRed })

        const rawPhone = s.phone || s.phoneManuel || null
        const phone = rawPhone ? rawPhone.replace(/^\+242/, '') : ''
        const contacts = phone ? [{ name: s.family || `${s.firstName} ${s.lastName}`, phone, dialCode: '+242', relation: 'Tuteur' }] : []

        const studentRef = await addDoc(collection(db, 'students'), {
          firstName: s.firstName, lastName: s.lastName, gender: s.gender,
          classId: classIds[s.className] ?? '',
          familyId: s.family ? (familyIds[s.family] ?? null) : null,
          contacts, isActive: s.status !== 'absent',
          schoolYearId, userId: uid, appliedFees,
        })

        // Monthly entries
        type FeeEntry = { feeId: string; feeName: string; amount: number; reduction: number; lastUnpaid: string | null; partial: number }
        const feeEntries: FeeEntry[] = [
          { feeId: feeIds.school, feeName: 'Scolarité', amount: schoolFeeAmt, reduction: schoolRed, lastUnpaid: s.schoolLastUnpaidMonth ?? null, partial: s.schoolPartialPayment ?? 0 },
        ]
        if (s.grandBus && feeIds.grandBus) feeEntries.push({ feeId: feeIds.grandBus, feeName: 'Grand Bus', amount: gbFeeAmt, reduction: busRed, lastUnpaid: s.busLastUnpaidMonth ?? null, partial: s.busPartialPayment ?? 0 })
        if (s.petitBus && feeIds.petitBus) feeEntries.push({ feeId: feeIds.petitBus, feeName: 'Petit Bus', amount: pbFeeAmt, reduction: busRed, lastUnpaid: s.busLastUnpaidMonth ?? null, partial: s.busPartialPayment ?? 0 })
        if (s.canteen && feeIds.canteen) feeEntries.push({ feeId: feeIds.canteen, feeName: 'Cantine', amount: ctFeeAmt, reduction: ctRed, lastUnpaid: s.canteenLastUnpaidMonth ?? null, partial: s.canteenPartialPayment ?? 0 })

        for (const md of MONTHS) {
          const fees = feeEntries.map(f => {
            const due = Math.max(0, f.amount - f.reduction)
            let paid = 0
            if (f.lastUnpaid) {
              const lastIdx = MONTHS.findIndex(m => m.value === f.lastUnpaid)
              const curIdx = MONTHS.findIndex(m => m.value === md.value)
              if (curIdx < lastIdx) paid = due
              else if (curIdx === lastIdx) paid = Math.min(f.partial, due)
            }
            return { feeId: f.feeId, feeName: f.feeName, amount: f.amount, reduction: f.reduction, due, paid, balance: due - paid }
          })
          const totalDue = fees.reduce((a, f) => a + f.due, 0)
          const totalPaid = fees.reduce((a, f) => a + f.paid, 0)
          await addDoc(collection(db, 'monthlyEntries'), {
            studentId: studentRef.id, schoolYearId, userId: uid,
            month: md.month, year: md.year, isActive: true,
            fees, totalDue, totalPaid, totalBalance: totalDue - totalPaid,
            generatedAt: new Date().toISOString(),
          })
        }
      }

      setExportDone(true)
    } catch (e: any) {
      setExportError(e.message ?? 'Erreur lors de l\'export.')
    } finally {
      setExporting(false)
    }
  }

  async function importData() {
    if (!uid) return
    setImporting(true)
    setError('')
    try {
      const res = await fetch('/migration-data.json')
      const { students, classes } = await res.json()

      for (const className of classes) {
        const sessionId = `${uid}_${className.replace(/\s+/g, '_')}`
        const code = generateCode(className)
        await setDoc(doc(db, 'migrationSessions', sessionId), { uid, className, code, createdAt: new Date().toISOString() })
        const classStudents = students.filter((s: any) => s.className === className)
        const batch = writeBatch(db)
        classStudents.forEach((s: any) => {
          const ref = doc(collection(db, 'migrationSessions', sessionId, 'students'))
          batch.set(ref, { ...s, id: ref.id })
        })
        await batch.commit()
      }
      await loadData()
    } catch (e) {
      setError('Erreur lors de l\'import : ' + String(e))
    } finally {
      setImporting(false)
    }
  }

  async function createFamily() {
    if (!newFamilyName.trim()) return
    setSavingFamily(true)
    const name = newFamilyName.trim()
    setFamilies(prev => [...prev, { name, students: [] }].sort((a, b) => a.name.localeCompare(b.name)))
    setNewFamilyName('')
    setShowNewFamily(false)
    setSavingFamily(false)
  }

  async function assignStudentToFamily(student: MigrationStudent, familyName: string) {
    await updateDoc(doc(db, 'migrationSessions', student.sessionId, 'students', student.id), { family: familyName })
    const updated = allStudents.map(s => s.id === student.id ? { ...s, family: familyName } : s)
    setAllStudents(updated)
    buildFamilies(updated)
    if (selectedFamily) {
      setSelectedFamily({ ...selectedFamily, students: [...selectedFamily.students, { ...student, family: familyName }] })
    }
    setShowAddStudentToFamily(false)
    setStudentSearch('')
  }

  async function removeStudentFromFamily(student: MigrationStudent) {
    await updateDoc(doc(db, 'migrationSessions', student.sessionId, 'students', student.id), { family: null })
    const updated = allStudents.map(s => s.id === student.id ? { ...s, family: null } : s)
    setAllStudents(updated)
    buildFamilies(updated)
    if (selectedFamily) {
      setSelectedFamily({ ...selectedFamily, students: selectedFamily.students.filter(s => s.id !== student.id) })
    }
  }

  // Stats classes
  const totalClasses = sessions.length
  const doneClasses = sessions.filter(s => s.status === 'done').length
  const allDone = totalClasses > 0 && doneClasses === totalClasses
  const totalStudents = allStudents.length
  const studentsWithoutFamily = allStudents.filter(s => !s.family)
  const studentsWithFamily = allStudents.filter(s => !!s.family)

  const claimingStudents = allStudents.filter(s => s.familyClaim)
  const contestingStudents = allStudents.filter(s => s.familyContested)

  const canExport = imported && allStudents.length > 0 && allStudents.every(s => s.status !== 'pending')
  const goneStudents = allStudents.filter(s => s.status === 'gone')

  const filteredSessions = sessions.filter(s => {
    if (classFilter === 'all') return true
    if (classFilter === 'absent') return s.absent > 0
    if (classFilter === 'gone') return s.gone > 0
    if (classFilter === 'new') return s.newStudents > 0
    if (classFilter === 'done') return s.status === 'done'
    if (classFilter === 'admin_reviewed') return (s as any).adminReviewed === true
    if (classFilter === 'to_review') return s.status === 'done' && !(s as any).adminReviewed
    if (classFilter === 'claiming') return claimingStudents.some(st => st.className === s.className)
    if (classFilter === 'contesting') return contestingStudents.some(st => st.className === s.className)
    return s.status === classFilter
  })

  // Familles filtrées
  const filteredFamilies = familySearch.trim()
    ? families.filter(f => f.name.toLowerCase().includes(familySearch.toLowerCase()))
    : families

  // Tous les élèves pour la modal (avec recherche)
  const searchedStudents = studentSearch.trim()
    ? allStudents.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(studentSearch.toLowerCase()))
    : allStudents

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Migration des élèves</h1>
          <p className="text-sm text-slate-500 mt-1">Vérification et import des données Excel</p>
        </div>
        <div className="flex items-center gap-2">
          {imported && (
            <button onClick={() => setShowCodes(!showCodes)}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">
              🔑 Codes d'accès
            </button>
          )}
          {imported && (
            <Link href="/dashboard/migration/numerotation"
              className="flex items-center gap-2 px-4 py-2 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold hover:bg-[#00B8E6] transition-colors">
              🔢 Numérotation
            </Link>
          )}
          {imported && (
            <button onClick={() => { setShowExportModal(true); setExportDone(false); setExportError('') }}
              disabled={!canExport}
              title={canExport ? 'Exporter vers la base de données' : 'Tous les élèves doivent avoir un statut défini'}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${canExport ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
              📤 Exporter
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>}

      {!imported ? (
        <div className="space-y-4">
          {/* Configuration des frais */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-base font-bold text-slate-900 mb-1">💰 Frais de l'année</h2>
            <p className="text-xs text-slate-400 mb-4">Ces montants s'appliqueront aux élèves lors de l'import final.</p>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Scolarité', value: scolariteFee, set: setScolariteFee, icon: '📚' },
                { label: 'Grand Bus', value: grandBusFee, set: setGrandBusFee, icon: '🚌' },
                { label: 'Petit Bus', value: petitBusFee, set: setPetitBusFee, icon: '🚐' },
                { label: 'Cantine', value: canteenFee, set: setCanteenFee, icon: '🍽️' },
              ].map(({ label, value, set, icon }) => (
                <div key={label}>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">{icon} {label}</label>
                  <div className="relative">
                    <input value={value} onChange={e => set(e.target.value.replace(/\D/g, ''))}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00D1FF] pr-16" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">FCFA</span>
                  </div>
                </div>
              ))}
            </div>
            {feesSaved && <p className="text-xs text-emerald-500 mt-3">✅ Frais sauvegardés</p>}
          </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Importer la liste Excel</h2>
          <p className="text-slate-500 text-sm mb-6">272 élèves · 12 classes · 73 familles</p>
          <button onClick={importData} disabled={importing}
            className="px-6 py-3 bg-[#00D1FF] text-white rounded-xl font-semibold hover:bg-[#00b8e0] disabled:opacity-60 transition-colors">
            {importing ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Import en cours…
              </span>
            ) : '🚀 Lancer l\'import'}
          </button>
        </div>
        </div>
      ) : (
        <>
          {/* Codes d'accès */}
          {/* Frais éditables */}
          <div className="bg-white rounded-xl border border-slate-100 p-5 mb-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">💰 Frais de l'année</h3>
                <p className="text-xs text-slate-400">Modifiables à tout moment</p>
              </div>
              <button onClick={saveFees} disabled={savingFees}
                className="px-4 py-1.5 bg-[#00D1FF] text-white rounded-xl text-xs font-semibold hover:bg-[#00b8e0] disabled:opacity-60 transition-colors">
                {savingFees ? '…' : feesSaved ? '✅ Sauvegardé' : 'Sauvegarder'}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: '📚 Scolarité', value: scolariteFee, set: setScolariteFee },
                { label: '🚌 Grand Bus', value: grandBusFee, set: setGrandBusFee },
                { label: '🚐 Petit Bus', value: petitBusFee, set: setPetitBusFee },
                { label: '🍽️ Cantine', value: canteenFee, set: setCanteenFee },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">{label}</label>
                  <div className="relative">
                    <input value={value} onChange={e => set(e.target.value.replace(/\D/g, ''))}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00D1FF] pr-14" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">FCFA</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {showCodes && (
            <div className="bg-slate-900 text-white rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Codes d'accès enseignants</h3>
                <button onClick={() => window.print()} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg">🖨️ Imprimer</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {sessions.map(s => (
                  <div key={s.id} className="bg-white/10 rounded-xl p-3">
                    <p className="font-bold text-sm">{s.className}</p>
                    <p className="text-[#00D1FF] font-mono text-lg font-bold">{s.code}</p>
                    <p className="text-white/50 text-xs mt-1">{s.total} élèves</p>
                  </div>
                ))}
              </div>
              <p className="text-white/40 text-xs mt-4 text-center">
                Accès : {typeof window !== 'undefined' ? window.location.origin : ''}/migration
              </p>
            </div>
          )}

          {/* Stats globales */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white rounded-xl border border-slate-100 p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-slate-900">{totalStudents}</p>
              <p className="text-xs text-slate-500 mt-0.5">Élèves total</p>
            </div>
            <div className="bg-white rounded-xl border border-emerald-100 p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-emerald-600">{studentsWithFamily.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">Dans une famille</p>
            </div>
            <div className="bg-white rounded-xl border border-amber-100 p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-amber-500">{studentsWithoutFamily.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">Sans famille</p>
            </div>
          </div>

          {/* Onglets principaux */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-6 w-fit">
            <button onClick={() => setMainTab('classes')}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${mainTab === 'classes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              🏫 Classes ({totalClasses})
            </button>
            <button onClick={() => setMainTab('familles')}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${mainTab === 'familles' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              👨‍👩‍👧 Familles ({families.length})
            </button>
          </div>

          {/* ── ONGLET CLASSES ── */}
          {mainTab === 'classes' && (
            <>
              {/* Tabs filtre scrollables */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                {[
                  { key: 'all', label: 'Toutes', value: totalClasses, active: 'bg-slate-900 text-white', inactive: 'bg-white border border-slate-200 text-slate-600' },
                  { key: 'not_started', label: 'Pas débutées', value: sessions.filter(s => s.status === 'not_started').length, active: 'bg-slate-500 text-white', inactive: 'bg-white border border-slate-200 text-slate-500' },
                  { key: 'in_progress', label: 'En cours', value: sessions.filter(s => s.status === 'in_progress').length, active: 'bg-amber-500 text-white', inactive: 'bg-white border border-amber-200 text-amber-600' },
                  { key: 'done', label: 'Terminées', value: sessions.filter(s => s.status === 'done').length, active: 'bg-emerald-500 text-white', inactive: 'bg-white border border-emerald-200 text-emerald-600' },
                  { key: 'admin_reviewed', label: '✅ Contrôlées', value: sessions.filter(s => (s as any).adminReviewed).length, active: 'bg-emerald-700 text-white', inactive: 'bg-white border border-emerald-200 text-emerald-700' },
                  { key: 'to_review', label: '🔍 À contrôler', value: sessions.filter(s => s.status === 'done' && !(s as any).adminReviewed).length, active: 'bg-blue-600 text-white', inactive: 'bg-white border border-blue-200 text-blue-600' },
                  { key: 'absent', label: 'Avec absents', value: sessions.filter(s => s.absent > 0).length, active: 'bg-amber-400 text-white', inactive: 'bg-white border border-amber-200 text-amber-600' },
                  { key: 'gone', label: 'Non identifiés', value: sessions.filter(s => s.gone > 0).length, active: 'bg-orange-500 text-white', inactive: 'bg-white border border-orange-200 text-orange-500' },
                  { key: 'new', label: 'Nouveaux', value: sessions.filter(s => s.newStudents > 0).length, active: 'bg-purple-600 text-white', inactive: 'bg-white border border-purple-200 text-purple-600' },
                  { key: 'claiming', label: '🏠 Réclament famille', value: claimingStudents.length, active: 'bg-blue-500 text-white', inactive: 'bg-white border border-blue-200 text-blue-600' },
                  { key: 'contesting', label: '⚠️ Contestent famille', value: contestingStudents.length, active: 'bg-red-500 text-white', inactive: 'bg-white border border-red-200 text-red-500' },
                ].map(({ key, label, value, active, inactive }) => (
                  <button key={key} onClick={() => setClassFilter(key as typeof classFilter)}
                    className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${classFilter === key ? active : inactive}`}>
                    <span className="font-bold text-base leading-none">{value}</span>
                    <span className="whitespace-nowrap">{label}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {filteredSessions.length === 0 && (
                  <p className="text-center text-slate-400 text-sm py-8">Aucune classe dans cette catégorie</p>
                )}
                {filteredSessions.map(s => (
                  <div key={s.id} className="flex items-center gap-2 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-[#00D1FF]/30 transition-colors overflow-hidden">
                    <Link href={`/dashboard/migration/${s.id}`} className="flex items-center gap-4 p-4 flex-1 min-w-0">
                      <div className={`w-2 h-12 rounded-full flex-shrink-0 ${(s as any).adminReviewed ? 'bg-emerald-600' : (s as any).teacherDone ? 'bg-emerald-300' : s.status === 'in_progress' ? 'bg-amber-400' : 'bg-slate-200'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-slate-900">{s.className}</p>
                          {(s as any).adminReviewed && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">✅ Contrôlé</span>}
                          {(s as any).teacherDone && !(s as any).adminReviewed && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600">🔍 À contrôler</span>}
                          {!(s as any).teacherDone && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === 'in_progress' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                            {s.status === 'in_progress' ? 'En cours' : 'Pas débuté'}
                          </span>}
                        </div>
                        <div className="flex gap-3 text-xs text-slate-500">
                          <span>{s.done}/{s.total} traités</span>
                          {s.present > 0 && <span className="text-emerald-600">✅ {s.present}</span>}
                          {s.absent > 0 && <span className="text-amber-600">⚠️ {s.absent}</span>}
                          {s.gone > 0 && <span className="text-orange-500">❓ {s.gone}</span>}
                          {s.newStudents > 0 && <span className="text-purple-600">➕ {s.newStudents}</span>}
                        </div>
                        {(() => {
                          const classStudents = allStudents.filter(st => st.className === s.className)
                          const withoutFam = classStudents.filter(st => !st.family)
                          const famNames = [...new Set(classStudents.map(st => st.family).filter(Boolean))]
                          const claiming = classStudents.filter(st => st.familyClaim)
                          const contesting = classStudents.filter(st => st.familyContested)
                          return (
                            <div className="flex flex-wrap gap-2 mt-1.5 text-xs">
                              <span className="text-[#00D1FF]">👨‍👩‍👧 {famNames.length} famille{famNames.length > 1 ? 's' : ''}</span>
                              {withoutFam.length > 0 && <span className="text-amber-500">⚠️ {withoutFam.length} sans famille</span>}
                              {claiming.length > 0 && <span className="text-blue-500">🏠 {claiming.length} réclame{claiming.length > 1 ? 'nt' : ''}</span>}
                              {contesting.length > 0 && <span className="text-red-400">⚠️ {contesting.length} conteste{contesting.length > 1 ? 'nt' : ''}</span>}
                            </div>
                          )
                        })()}
                      </div>
                      <svg className="w-5 h-5 text-slate-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                    {/* Bouton contrôler */}
                    <button
                      onClick={async () => {
                        const newVal = !(s as any).adminReviewed
                        setSessions(prev => prev.map(p => p.id === s.id ? { ...p, adminReviewed: newVal } as any : p))
                        await updateDoc(doc(db, 'migrationSessions', s.id), { adminReviewed: newVal })
                      }}
                      className={`flex-shrink-0 flex flex-col items-center justify-center w-16 h-full py-4 text-xs font-semibold transition-colors border-l ${
                        (s as any).adminReviewed
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-red-50 hover:text-red-500 hover:border-red-100'
                          : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-emerald-50 hover:text-emerald-600'
                      }`}
                      title={(s as any).adminReviewed ? 'Annuler le contrôle' : 'Marquer comme contrôlé'}>
                      {(s as any).adminReviewed ? '✅' : '○'}
                      <span className="mt-0.5 leading-tight text-center">{(s as any).adminReviewed ? 'Contrôlé' : 'Contrôler'}</span>
                    </button>
                  </div>
                ))}
              </div>

              {allDone && (
                <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
                  <p className="text-emerald-800 font-semibold mb-1">✅ Toutes les classes sont traitées !</p>
                  <p className="text-emerald-600 text-sm mb-4">Passez à l'étape de numérotation avant l'import final.</p>
                  <Link href="/dashboard/migration/numerotation"
                    className="inline-block px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors text-sm">
                    Étape suivante : Numérotation →
                  </Link>
                </div>
              )}
            </>
          )}

          {/* ── ONGLET FAMILLES ── */}
          {mainTab === 'familles' && (
            <div className="flex gap-6">
              {/* Liste familles */}
              <div className="w-72 flex-shrink-0">
                <div className="flex gap-2 mb-3">
                  <input value={familySearch} onChange={e => setFamilySearch(e.target.value)}
                    placeholder="Rechercher une famille…"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                  <button onClick={() => setShowNewFamily(true)}
                    className="px-3 py-2 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold hover:bg-[#00b8e0] whitespace-nowrap">
                    + Nouvelle
                  </button>
                </div>

                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {filteredFamilies.map(f => (
                    <button key={f.name} onClick={() => setSelectedFamily(f)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all ${
                        selectedFamily?.name === f.name ? 'bg-[#00D1FF] text-white' : 'bg-white border border-slate-100 hover:border-[#00D1FF]/30 text-slate-700'
                      }`}>
                      <div>
                        <p className="font-medium text-sm">{f.name}</p>
                        <p className={`text-xs mt-0.5 ${selectedFamily?.name === f.name ? 'text-white/70' : 'text-slate-400'}`}>
                          {f.students.length} élève{f.students.length > 1 ? 's' : ''}
                        </p>
                      </div>
                      <svg className="w-4 h-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                  {filteredFamilies.length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-6">Aucune famille trouvée</p>
                  )}
                </div>
              </div>

              {/* Détail famille */}
              <div className="flex-1">
                {!selectedFamily ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm bg-white rounded-xl border border-slate-100 p-8">
                    ← Sélectionnez une famille
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="font-bold text-slate-900">{selectedFamily.name}</h2>
                        <p className="text-xs text-slate-400">{selectedFamily.students.length} élève{selectedFamily.students.length > 1 ? 's' : ''}</p>
                      </div>
                      <button onClick={() => setShowAddStudentToFamily(true)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-purple-100 text-purple-700 rounded-xl text-sm font-semibold hover:bg-purple-200">
                        ➕ Ajouter un élève
                      </button>
                    </div>

                    <div className="space-y-2">
                      {selectedFamily.students.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-6">Aucun élève dans cette famille</p>
                      )}
                      {selectedFamily.students.map(s => (
                        <div key={s.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                            {s.firstName[0]}{s.lastName[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{s.firstName} {s.lastName}</p>
                            <p className="text-xs text-slate-400">{s.className}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            s.status === 'present' ? 'bg-emerald-50 text-emerald-600' :
                            s.status === 'absent' ? 'bg-amber-50 text-amber-600' :
                            s.status === 'gone' ? 'bg-orange-50 text-orange-500' :
                            s.status === 'new' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-400'
                          }`}>
                            {s.status === 'present' ? '✅' : s.status === 'absent' ? '⚠️' : s.status === 'gone' ? '❓' : s.status === 'new' ? '➕' : '⏳'}
                          </span>
                          <button onClick={() => removeStudentFromFamily(s)}
                            className="text-slate-300 hover:text-red-400 text-lg leading-none ml-1">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal nouvelle famille */}
      {showNewFamily && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setShowNewFamily(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-4">Nouvelle famille</h3>
            <input value={newFamilyName} onChange={e => setNewFamilyName(e.target.value)}
              placeholder="Nom de la famille"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && createFamily()}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setShowNewFamily(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">Annuler</button>
              <button onClick={createFamily} disabled={!newFamilyName.trim() || savingFamily}
                className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-bold disabled:opacity-60">
                Créer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajout élève à famille */}
      {showAddStudentToFamily && selectedFamily && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => { setShowAddStudentToFamily(false); setStudentSearch('') }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-1">Ajouter à {selectedFamily.name}</h3>
            <p className="text-xs text-slate-400 mb-4">Les élèves déjà dans une famille ne peuvent pas être ajoutés</p>
            <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
              placeholder="Rechercher un élève…"
              autoFocus
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] mb-3" />
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {searchedStudents.slice(0, 30).map(s => {
                const hasFamily = !!s.family
                const alreadyInThis = s.family === selectedFamily.name
                const isNew = s.addedManually || s.status === 'new'
                return (
                  <div key={s.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                      hasFamily ? 'opacity-60 bg-slate-50 cursor-not-allowed' : 'hover:bg-[#00D1FF]/5 cursor-pointer'
                    }`}
                    onClick={() => !hasFamily && assignStudentToFamily(s, selectedFamily.name)}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                      {s.firstName[0]}{s.lastName[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{s.firstName} {s.lastName}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${isNew ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-500'}`}>
                          {isNew ? '➕ Nouveau' : 'Ancien'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{s.className}</p>
                      {hasFamily && (
                        <p className="text-xs text-amber-600 font-medium mt-0.5">
                          {alreadyInThis ? '✅ Déjà dans cette famille' : `👨‍👩‍👧 ${s.family}`}
                        </p>
                      )}
                    </div>
                    {!hasFamily && (
                      <span className="text-[#00D1FF] text-sm font-bold flex-shrink-0">+ Ajouter</span>
                    )}
                    {hasFamily && !alreadyInThis && (
                      <span className="text-slate-300 text-xs flex-shrink-0">Indisponible</span>
                    )}
                  </div>
                )
              })}
              {searchedStudents.length === 0 && (
                <p className="text-center text-slate-400 text-sm py-4">Aucun élève trouvé</p>
              )}
            </div>
            <button onClick={() => { setShowAddStudentToFamily(false); setStudentSearch('') }}
              className="mt-4 w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">
              Fermer
            </button>
          </div>
        </div>
      )}
      {/* Modal export */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !exporting && setShowExportModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            {exportDone ? (
              <div className="text-center py-4">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="font-bold text-slate-900 text-lg mb-1">Export réussi !</h3>
                <p className="text-sm text-slate-500">Les données ont été transférées vers la base de données.</p>
                <button onClick={() => setShowExportModal(false)} className="mt-5 px-6 py-2.5 bg-emerald-500 text-white rounded-xl font-semibold text-sm">Fermer</button>
              </div>
            ) : (
              <>
                <h3 className="font-bold text-slate-900 text-lg mb-1">📤 Exporter vers la base de données</h3>
                <p className="text-sm text-slate-500 mb-4">
                  {allStudents.filter(s => s.status !== 'gone').length} élèves seront exportés.
                  {goneStudents.length > 0 && <> <span className="text-orange-500 font-medium">{goneStudents.length} élève{goneStudents.length > 1 ? 's' : ''} non identifié{goneStudents.length > 1 ? 's' : ''}</span> ne seront pas exportés.</>}
                </p>

                {goneStudents.length > 0 && (
                  <div className="mb-4 bg-orange-50 border border-orange-100 rounded-xl overflow-hidden">
                    <button onClick={() => setCollapsedGone(p => !p)}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors">
                      <span>🔍 Élèves non identifiés ({goneStudents.length})</span>
                      <span>{collapsedGone ? '▼' : '▲'}</span>
                    </button>
                    {!collapsedGone && (
                      <div className="px-4 pb-3 space-y-1 max-h-48 overflow-y-auto">
                        {goneStudents.map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-sm">
                            <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                            <span className="text-slate-700">{s.firstName} {s.lastName}</span>
                            <span className="text-slate-400 text-xs">· {s.className}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {exportError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">{exportError}</div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setShowExportModal(false)} disabled={exporting}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium disabled:opacity-60">
                    Annuler
                  </button>
                  <button onClick={runExport} disabled={exporting}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-60 transition-colors">
                    {exporting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Export en cours…
                      </span>
                    ) : 'Confirmer l\'export'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
