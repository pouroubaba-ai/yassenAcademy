'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, doc, getDocs, updateDoc, addDoc, deleteDoc, writeBatch } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import Link from 'next/link'

interface Student {
  id: string
  sessionId: string
  firstName: string
  lastName: string
  className: string
  gender: string
  family: string | null
  status: 'pending' | 'present' | 'absent' | 'gone' | 'new'
  familyConfirmed: boolean | null
  grandBus: boolean
  petitBus: boolean
  canteen: boolean
  addedManually: boolean
  familyClaim: boolean
  familyClaimName?: string
  familyContested: boolean
}

type Filter = 'all' | 'pending' | 'present' | 'absent' | 'gone' | 'new' | 'claiming' | 'contesting' | 'no_family'

const NIVEAU3_STUDENTS = [
  { firstName: 'Fanta', lastName: 'Lah', gender: 'F', family: null },
  { firstName: 'Hawa', lastName: 'Sylla', gender: 'F', family: 'Famille Sylla' },
  { firstName: 'Fatoumata', lastName: 'Bathily', gender: 'F', family: 'Famille Bathily' },
  { firstName: 'Oumou', lastName: 'Niangadou', gender: 'F', family: 'Famille Niangadou' },
  { firstName: 'Aïcha', lastName: 'Diallo', gender: 'F', family: 'Famille Diallo' },
  { firstName: "Awa", lastName: "N'Daou", gender: 'F', family: null },
  { firstName: 'Hafsa', lastName: 'Mohamed', gender: 'F', family: null },
  { firstName: 'Bintou', lastName: 'Samassa', gender: 'F', family: null },
  { firstName: 'Fatou', lastName: 'Camara', gender: 'F', family: 'Famille Camara' },
  { firstName: 'Tidiane', lastName: 'Kantako', gender: 'M', family: 'Famille Kantako' },
  { firstName: 'Abdallah', lastName: 'Kantako', gender: 'M', family: 'Famille Kantako' },
  { firstName: 'Soya', lastName: 'Bocoum', gender: 'F', family: 'Famille Bocoum' },
  { firstName: 'Mbaba', lastName: 'Bocoum', gender: 'M', family: 'Famille Bocoum' },
  { firstName: 'Mohamed', lastName: 'Bocoum', gender: 'M', family: 'Famille Bocoum' },
  { firstName: 'Abdallah', lastName: 'Diarra', gender: 'M', family: null },
  { firstName: 'Faousseni', lastName: 'Bocoum', gender: 'M', family: 'Famille Bocoum' },
  { firstName: 'Ousmane', lastName: 'Sylla', gender: 'M', family: 'Famille Sylla' },
  { firstName: 'Mouhamed', lastName: 'Sylla', gender: 'M', family: 'Famille Sylla' },
  { firstName: 'Ahmed', lastName: 'Sylla', gender: 'M', family: 'Famille Sylla' },
  { firstName: 'Moussa', lastName: 'Bocoum', gender: 'M', family: 'Famille Bocoum' },
  { firstName: 'Mouhamed', lastName: 'Diallo', gender: 'M', family: 'Famille Diallo' },
  { firstName: 'Silamakan', lastName: 'Camara', gender: 'M', family: 'Famille Camara' },
  { firstName: 'Aboubacar', lastName: 'Sacko', gender: 'M', family: null },
  { firstName: 'Nyouma', lastName: 'Tamboura', gender: 'F', family: null },
  { firstName: 'Aïcha', lastName: 'Ndao', gender: 'F', family: null },
  { firstName: 'Oumar', lastName: 'Samassa', gender: 'M', family: null },
  { firstName: 'Mohamed', lastName: 'Konaté', gender: 'M', family: null },
  { firstName: 'Faousseni', lastName: 'Yarra', gender: 'M', family: 'Famille Yarra' },
  { firstName: 'Amadi', lastName: 'Yarra', gender: 'M', family: 'Famille Yarra' },
  { firstName: 'Alfa', lastName: 'Niangadou', gender: 'M', family: 'Famille Niangadou' },
  { firstName: 'Modibo', lastName: 'Gamby', gender: 'M', family: null },
  { firstName: 'Ibrahim', lastName: 'Bathily', gender: 'M', family: 'Famille Bathily' },
  { firstName: 'Aïcha', lastName: 'Dao', gender: 'F', family: null },
]

export default function MigrationClassPage({ params }: PageProps<'/dashboard/migration/[sessionId]'>) {
  const [sessionId, setSessionId] = useState('')
  const [className, setClassName] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  // Modal famille (membres)
  const [familyModal, setFamilyModal] = useState<Student | null>(null)
  const [allFamilies, setAllFamilies] = useState<Record<string, Student[]>>({})

  // Modal assigner une famille (élève sans famille)
  const [assignModal, setAssignModal] = useState<Student | null>(null)
  const [familySearch, setFamilySearch] = useState('')
  const [newFamilyName, setNewFamilyName] = useState('')
  const [showCreateFamily, setShowCreateFamily] = useState(false)
  const [savingAssign, setSavingAssign] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    params.then(async ({ sessionId: sid }) => {
      const decodedSid = decodeURIComponent(sid)
      setSessionId(decodedSid)
      const parts = decodedSid.split('_')
      setClassName(parts.slice(1).join(' '))

      const snap = await getDocs(collection(db, 'migrationSessions', decodedSid, 'students'))
      const studs = snap.docs.map(d => ({
        familyClaim: false, familyContested: false, grandBus: false, petitBus: false,
        sessionId: decodedSid, ...d.data(), id: d.id,
      } as Student))
      setStudents(studs)

      // Familles complètes de toutes les sessions
      const sessionsSnap = await getDocs(collection(db, 'migrationSessions'))
      const allStuds: Student[] = []
      await Promise.all(sessionsSnap.docs.map(async sDoc => {
        const sSnap = await getDocs(collection(db, 'migrationSessions', sDoc.id, 'students'))
        sSnap.docs.forEach(d => allStuds.push({
          familyClaim: false, familyContested: false, grandBus: false, petitBus: false,
          sessionId: sDoc.id, ...d.data(), id: d.id,
        } as Student))
      }))
      const fams: Record<string, Student[]> = {}
      allStuds.forEach(s => {
        if (s.family) {
          if (!fams[s.family]) fams[s.family] = []
          fams[s.family].push(s)
        }
      })
      setAllFamilies(fams)
      setLoading(false)
    })
  }, [])

  async function updateStudent(studentId: string, updates: Partial<Student>) {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updates } : s))
    if (familyModal?.id === studentId) setFamilyModal(prev => prev ? { ...prev, ...updates } : null)
    await updateDoc(doc(db, 'migrationSessions', sessionId, 'students', studentId), updates)
  }

  async function removeFromFamily(student: Student) {
    await updateStudent(student.id, { family: null, familyConfirmed: null, familyContested: false })
    // Mettre à jour allFamilies localement
    setAllFamilies(prev => {
      if (!student.family) return prev
      const updated = { ...prev }
      updated[student.family] = (updated[student.family] ?? []).filter(s => s.id !== student.id)
      return updated
    })
    setFamilyModal(null)
  }

  async function assignToFamily(student: Student, familyName: string) {
    setSavingAssign(true)
    await updateStudent(student.id, { family: familyName, familyConfirmed: null, familyClaim: false })
    setAllFamilies(prev => {
      const updated = { ...prev }
      if (!updated[familyName]) updated[familyName] = []
      updated[familyName] = [...updated[familyName], { ...student, family: familyName }]
      return updated
    })
    setAssignModal(null)
    setFamilySearch('')
    setNewFamilyName('')
    setShowCreateFamily(false)
    setSavingAssign(false)
  }

  async function importNiveau3() {
    if (!sessionId) return
    setImporting(true)
    try {
      // Supprimer les élèves existants
      const existing = await getDocs(collection(db, 'migrationSessions', sessionId, 'students'))
      const batch = writeBatch(db)
      existing.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()

      // Ajouter les 33 nouveaux élèves
      const newStuds: Student[] = []
      for (const s of NIVEAU3_STUDENTS) {
        const ref = await addDoc(collection(db, 'migrationSessions', sessionId, 'students'), {
          firstName: s.firstName, lastName: s.lastName, gender: s.gender,
          family: s.family, className: 'Niveau 3',
          status: 'pending', familyConfirmed: null,
          grandBus: false, petitBus: false, canteen: false,
          addedManually: false, familyClaim: false, familyContested: false,
        })
        newStuds.push({ id: ref.id, sessionId, ...s, className: 'Niveau 3', status: 'pending', familyConfirmed: null, grandBus: false, petitBus: false, canteen: false, addedManually: false, familyClaim: false, familyContested: false })
      }
      setStudents(newStuds)
      setShowImportModal(false)
    } finally {
      setImporting(false)
    }
  }

  const pending = students.filter(s => s.status === 'pending').length
  const done = students.length - pending
  const claiming = students.filter(s => s.familyClaim)
  const contesting = students.filter(s => s.familyContested)
  const noFamily = students.filter(s => !s.family)

  const filtered = useMemo(() => {
    if (filter === 'all') return students
    if (filter === 'pending') return students.filter(s => s.status === 'pending')
    if (filter === 'present') return students.filter(s => s.status === 'present')
    if (filter === 'absent') return students.filter(s => s.status === 'absent')
    if (filter === 'gone') return students.filter(s => s.status === 'gone')
    if (filter === 'new') return students.filter(s => s.status === 'new' || s.addedManually)
    if (filter === 'claiming') return claiming
    if (filter === 'contesting') return contesting
    if (filter === 'no_family') return noFamily
    return students
  }, [students, filter])

  const familyList = Object.keys(allFamilies).sort()
  const filteredFamilies = familySearch.trim()
    ? familyList.filter(f => f.toLowerCase().includes(familySearch.toLowerCase()))
    : familyList

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/dashboard/migration" className="hover:text-[#00D1FF]">Migration</Link>
          <span>/</span>
          <span className="text-slate-900 font-medium">{className}</span>
        </div>
        {className === 'Niveau 3' && (
          <button onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-colors">
            📋 Importer liste officielle
          </button>
        )}
      </div>

      {/* Progression */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 mb-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-slate-900">{className} — {done}/{students.length} traités</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            pending === 0 ? 'bg-emerald-50 text-emerald-600' :
            done > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
          }`}>
            {pending === 0 ? 'Terminé' : done > 0 ? 'En cours' : 'Pas débuté'}
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2">
          <div className="bg-[#00D1FF] h-2 rounded-full transition-all" style={{ width: `${students.length > 0 ? (done / students.length) * 100 : 0}%` }} />
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-xs">
          {[
            { label: 'Présents', count: students.filter(s => s.status === 'present').length, color: 'text-emerald-600' },
            { label: 'Absents', count: students.filter(s => s.status === 'absent').length, color: 'text-amber-600' },
            { label: 'Non identifiés', count: students.filter(s => s.status === 'gone').length, color: 'text-orange-500' },
            { label: 'Nouveaux', count: students.filter(s => s.status === 'new' || s.addedManually).length, color: 'text-purple-600' },
            { label: 'Réclament famille', count: claiming.length, color: 'text-blue-500' },
            { label: 'Contestent famille', count: contesting.length, color: 'text-red-400' },
          ].map(({ label, count, color }) => count > 0 && (
            <span key={label} className={color}>{label}: {count}</span>
          ))}
        </div>
      </div>

      {/* Filtres scrollables */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {[
          { key: 'all', label: 'Tous', count: students.length, color: 'bg-slate-800 text-white', inactive: 'bg-white border border-slate-200 text-slate-600' },
          { key: 'pending', label: 'En attente', count: pending, color: 'bg-slate-400 text-white', inactive: 'bg-white border border-slate-200 text-slate-500' },
          { key: 'present', label: 'Présents', count: students.filter(s => s.status === 'present').length, color: 'bg-emerald-500 text-white', inactive: 'bg-white border border-emerald-200 text-emerald-600' },
          { key: 'absent', label: 'Absents', count: students.filter(s => s.status === 'absent').length, color: 'bg-amber-500 text-white', inactive: 'bg-white border border-amber-200 text-amber-600' },
          { key: 'gone', label: 'Non identifiés', count: students.filter(s => s.status === 'gone').length, color: 'bg-orange-500 text-white', inactive: 'bg-white border border-orange-200 text-orange-500' },
          { key: 'new', label: 'Nouveaux', count: students.filter(s => s.status === 'new' || s.addedManually).length, color: 'bg-purple-600 text-white', inactive: 'bg-white border border-purple-200 text-purple-600' },
          { key: 'no_family', label: 'Sans famille', count: noFamily.length, color: 'bg-slate-600 text-white', inactive: 'bg-white border border-slate-200 text-slate-500' },
          { key: 'claiming', label: '🏠 Réclament famille', count: claiming.length, color: 'bg-blue-500 text-white', inactive: 'bg-white border border-blue-200 text-blue-600' },
          { key: 'contesting', label: '⚠️ Contestent famille', count: contesting.length, color: 'bg-red-500 text-white', inactive: 'bg-white border border-red-200 text-red-500' },
        ].map(({ key, label, count, color, inactive }) => (
          <button key={key} onClick={() => setFilter(key as Filter)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${filter === key ? color : inactive}`}>
            <span className="font-bold">{count}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Liste élèves */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">Aucun élève dans cette catégorie</p>
        )}
        {filtered.map(s => (
          <div key={s.id} className={`rounded-xl border p-4 transition-all ${
            s.status === 'present' ? 'border-emerald-200 bg-emerald-50' :
            s.status === 'absent' ? 'border-amber-200 bg-amber-50' :
            s.status === 'gone' ? 'border-red-200 bg-red-50' :
            s.status === 'new' ? 'border-purple-200 bg-purple-50' : 'border-slate-200 bg-white'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                {s.firstName[0]}{s.lastName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{s.firstName} {s.lastName}</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  {s.family ? (
                    <button onClick={() => setFamilyModal(s)} className="text-xs text-[#00D1FF] hover:underline">
                      👨‍👩‍👧 {s.family}
                    </button>
                  ) : (
                    <button onClick={() => { setAssignModal(s); setFamilySearch('') }}
                      className="text-xs text-slate-400 hover:text-[#00D1FF] border border-dashed border-slate-300 hover:border-[#00D1FF] px-2 py-0.5 rounded-full transition-colors">
                      + Assigner famille
                    </button>
                  )}
                  {s.familyClaim && (
                    <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
                      🏠 Réclame famille{s.familyClaimName ? ` → "${s.familyClaimName}"` : ''}
                    </span>
                  )}
                  {s.familyContested && <span className="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">⚠️ Conteste famille</span>}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                s.status === 'present' ? 'bg-emerald-100 text-emerald-700' :
                s.status === 'absent' ? 'bg-amber-100 text-amber-700' :
                s.status === 'gone' ? 'bg-orange-100 text-orange-600' :
                s.status === 'new' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {s.status === 'present' ? '✅ Présent' :
                 s.status === 'absent' ? '⚠️ Absent' :
                 s.status === 'gone' ? '❓ Non identifié' :
                 s.status === 'new' ? '➕ Nouveau' : '⏳ En attente'}
              </span>
            </div>

            {/* Boutons statut admin */}
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {[
                { status: 'present', label: '✅ Présent', active: 'bg-emerald-100 text-emerald-700 border-emerald-300', inactive: 'bg-white text-slate-400 border-slate-200' },
                { status: 'absent', label: '⚠️ Absent', active: 'bg-amber-100 text-amber-700 border-amber-300', inactive: 'bg-white text-slate-400 border-slate-200' },
                { status: 'gone', label: '❓ Non identifié', active: 'bg-orange-100 text-orange-600 border-orange-300', inactive: 'bg-white text-slate-400 border-slate-200' },
              ].map(({ status, label, active, inactive }) => (
                <button key={status} onClick={() => updateStudent(s.id, { status: status as Student['status'] })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${s.status === status ? active : inactive}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* Services */}
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <button onClick={() => updateStudent(s.id, { grandBus: !s.grandBus, ...(s.grandBus ? {} : { petitBus: false }) })}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${s.grandBus ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-slate-400 border-slate-200'}`}>
                🚌 Grand Bus
              </button>
              <button onClick={() => updateStudent(s.id, { petitBus: !s.petitBus, ...(s.petitBus ? {} : { grandBus: false }) })}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${s.petitBus ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-white text-slate-400 border-slate-200'}`}>
                🚐 Petit Bus
              </button>
              <button onClick={() => updateStudent(s.id, { canteen: !s.canteen })}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${s.canteen ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-white text-slate-400 border-slate-200'}`}>
                🍽️ Cantine
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal membres de la famille ── */}
      {familyModal && familyModal.family && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4" onClick={() => setFamilyModal(null)}>
          <div className="bg-white rounded-t-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-1">{familyModal.family}</h3>
            <p className="text-xs text-slate-400 mb-4">Membres de cette famille</p>
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {(allFamilies[familyModal.family] ?? []).map(fs => (
                <div key={fs.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${fs.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                    {fs.firstName[0]}{fs.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{fs.firstName} {fs.lastName}</p>
                    <p className="text-xs text-slate-500">{fs.className}</p>
                    {fs.familyContested && <p className="text-xs text-red-500 font-medium">⚠️ Conteste cette famille</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    fs.status === 'present' ? 'bg-emerald-50 text-emerald-600' :
                    fs.status === 'absent' ? 'bg-amber-50 text-amber-600' :
                    fs.status === 'gone' ? 'bg-orange-50 text-orange-500' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {fs.status === 'present' ? '✅' : fs.status === 'absent' ? '⚠️' : fs.status === 'gone' ? '❓' : '⏳'}
                  </span>
                </div>
              ))}
            </div>

            {/* Retirer l'élève courant de la famille */}
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500 mb-2">Actions pour <span className="font-semibold text-slate-700">{familyModal.firstName} {familyModal.lastName}</span> :</p>
              <button onClick={() => removeFromFamily(familyModal)}
                className="w-full py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100 transition-colors">
                🚪 Retirer de la famille {familyModal.family}
              </button>
            </div>

            <button onClick={() => setFamilyModal(null)} className="mt-3 w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">Fermer</button>
          </div>
        </div>
      )}

      {/* ── Modal assigner une famille ── */}
      {assignModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4" onClick={() => { setAssignModal(null); setShowCreateFamily(false) }}>
          <div className="bg-white rounded-t-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-0.5">Assigner une famille</h3>
            <p className="text-xs text-slate-400 mb-4">{assignModal.firstName} {assignModal.lastName}</p>

            {!showCreateFamily ? (
              <>
                <input value={familySearch} onChange={e => setFamilySearch(e.target.value)}
                  placeholder="Rechercher une famille…"
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] mb-3" />
                <div className="space-y-1.5 max-h-56 overflow-y-auto mb-4">
                  {filteredFamilies.map(fname => (
                    <button key={fname} onClick={() => assignToFamily(assignModal, fname)} disabled={savingAssign}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-[#00D1FF]/5 border border-transparent hover:border-[#00D1FF]/20 text-left transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{fname}</p>
                        <p className="text-xs text-slate-400">{(allFamilies[fname] ?? []).length} élève{(allFamilies[fname] ?? []).length > 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-[#00D1FF] text-xs font-bold">Ajouter →</span>
                    </button>
                  ))}
                  {filteredFamilies.length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-3">Aucune famille trouvée</p>
                  )}
                </div>
                <button onClick={() => setShowCreateFamily(true)}
                  className="w-full py-2.5 border-2 border-dashed border-slate-300 text-slate-500 rounded-xl text-sm font-medium hover:border-[#00D1FF] hover:text-[#00D1FF] transition-colors">
                  ➕ Créer une nouvelle famille
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-3">Nom de la nouvelle famille :</p>
                <input value={newFamilyName} onChange={e => setNewFamilyName(e.target.value)}
                  placeholder="Ex: Famille Traoré"
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] mb-4" />
                <div className="flex gap-2">
                  <button onClick={() => setShowCreateFamily(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm">Annuler</button>
                  <button onClick={() => newFamilyName.trim() && assignToFamily(assignModal, newFamilyName.trim())}
                    disabled={!newFamilyName.trim() || savingAssign}
                    className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-bold disabled:opacity-60">
                    {savingAssign ? '…' : 'Créer et assigner'}
                  </button>
                </div>
              </>
            )}

            <button onClick={() => { setAssignModal(null); setShowCreateFamily(false) }}
              className="mt-3 w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">
              Fermer
            </button>
          </div>
        </div>
      )}
      {/* Modal import liste officielle Niveau 3 */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !importing && setShowImportModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 text-lg mb-1">📋 Importer liste officielle</h3>
            <p className="text-sm text-slate-500 mb-4">
              Ceci va <span className="text-red-500 font-semibold">remplacer les {students.length} élèves actuels</span> du Niveau 3 par la liste officielle de <span className="font-semibold text-slate-700">33 élèves</span>.
            </p>
            <div className="bg-slate-50 rounded-xl p-3 mb-4 max-h-48 overflow-y-auto space-y-1">
              {NIVEAU3_STUDENTS.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>{s.gender}</span>
                  <span className="text-slate-700">{s.firstName} {s.lastName}</span>
                  {s.family && <span className="text-xs text-slate-400 truncate">· {s.family}</span>}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowImportModal(false)} disabled={importing}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium disabled:opacity-60">
                Annuler
              </button>
              <button onClick={importNiveau3} disabled={importing}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-60 transition-colors">
                {importing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Import…
                  </span>
                ) : 'Confirmer le remplacement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
