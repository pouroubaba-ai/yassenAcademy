'use client'

import { useState, useEffect } from 'react'
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import Link from 'next/link'

interface Student {
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
}

export default function MigrationClassPage({ params }: PageProps<'/dashboard/migration/[sessionId]'>) {
  const [sessionId, setSessionId] = useState('')
  const [className, setClassName] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'present' | 'absent' | 'gone' | 'new'>('all')
  const [familyModal, setFamilyModal] = useState<Student | null>(null)
  const [allFamilies, setAllFamilies] = useState<Record<string, Student[]>>({})

  useEffect(() => {
    params.then(async ({ sessionId: sid }) => {
      const decodedSid = decodeURIComponent(sid)
      setSessionId(decodedSid)
      const parts = decodedSid.split('_')
      setClassName(parts.slice(1).join(' '))

      const snap = await getDocs(collection(db, 'migrationSessions', decodedSid, 'students'))
      const studs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Student))
      setStudents(studs)

      // Charger tous les élèves de toutes les sessions pour les familles complètes
      const sessionsSnap = await getDocs(collection(db, 'migrationSessions'))
      const allStuds: Student[] = []
      await Promise.all(sessionsSnap.docs.map(async sessionDoc => {
        const sSnap = await getDocs(collection(db, 'migrationSessions', sessionDoc.id, 'students'))
        sSnap.docs.forEach(d => allStuds.push({ id: d.id, ...d.data() } as Student))
      }))
      const families: Record<string, Student[]> = {}
      allStuds.forEach(s => {
        if (s.family) {
          if (!families[s.family]) families[s.family] = []
          families[s.family].push(s)
        }
      })
      setAllFamilies(families)
      setLoading(false)
    })
  }, [])

  async function updateStudent(studentId: string, updates: Partial<Student>) {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updates } : s))
    await updateDoc(doc(db, 'migrationSessions', sessionId, 'students', studentId), updates)
  }

  const filtered = filter === 'all' ? students : students.filter(s => s.status === filter)
  const pending = students.filter(s => s.status === 'pending').length
  const done = students.length - pending

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Link href="/dashboard/migration" className="hover:text-[#00D1FF]">Migration</Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">{className}</span>
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
          <div className="bg-[#00D1FF] h-2 rounded-full transition-all" style={{ width: `${(done / students.length) * 100}%` }} />
        </div>
        <div className="flex gap-4 mt-3 text-xs">
          {[
            { label: 'Présents', count: students.filter(s => s.status === 'present').length, color: 'text-emerald-600' },
            { label: 'Absents', count: students.filter(s => s.status === 'absent').length, color: 'text-amber-600' },
            { label: 'Non identifiés', count: students.filter(s => s.status === 'gone').length, color: 'text-orange-500' },
            { label: 'Nouveaux', count: students.filter(s => s.status === 'new' || s.addedManually).length, color: 'text-purple-600' },
          ].map(({ label, count, color }) => count > 0 && (
            <span key={label} className={color}>{label}: {count}</span>
          ))}
        </div>
      </div>

      {/* Filtres */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {[
          { key: 'all', label: 'Tous' },
          { key: 'pending', label: `En attente (${pending})` },
          { key: 'present', label: 'Présents' },
          { key: 'absent', label: 'Absents' },
          { key: 'gone', label: 'Partis' },
          { key: 'new', label: 'Nouveaux' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key as typeof filter)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
              filter === key ? 'bg-[#00D1FF] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Liste élèves */}
      <div className="space-y-2">
        {filtered.map(s => (
          <StudentAdminRow key={s.id} student={s} families={allFamilies}
            onUpdate={(updates) => updateStudent(s.id, updates)}
            onShowFamily={() => setFamilyModal(s)} />
        ))}
      </div>

      {/* Modal famille */}
      {familyModal && familyModal.family && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 p-4" onClick={() => setFamilyModal(null)}>
          <div className="bg-white rounded-t-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-1">{familyModal.family}</h3>
            <p className="text-xs text-slate-400 mb-4">Élèves de cette famille dans la liste</p>
            <div className="space-y-2">
              {(allFamilies[familyModal.family] ?? []).map(fs => (
                <div key={fs.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${fs.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                    {fs.firstName[0]}{fs.lastName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{fs.firstName} {fs.lastName}</p>
                    <p className="text-xs text-slate-500">{fs.className}</p>
                  </div>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                    fs.status === 'present' ? 'bg-emerald-50 text-emerald-600' :
                    fs.status === 'absent' ? 'bg-amber-50 text-amber-600' :
                    fs.status === 'gone' ? 'bg-orange-50 text-orange-500' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {fs.status === 'present' ? '✅' : fs.status === 'absent' ? '⚠️' : fs.status === 'gone' ? '❌' : '⏳'}
                  </span>
                </div>
              ))}
            </div>
            <button onClick={() => setFamilyModal(null)} className="mt-4 w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">Fermer</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StudentAdminRow({ student, families, onUpdate, onShowFamily }: {
  student: Student
  families: Record<string, Student[]>
  onUpdate: (u: Partial<Student>) => void
  onShowFamily: () => void
}) {
  const statusColors = {
    pending: 'border-slate-200 bg-white',
    present: 'border-emerald-200 bg-emerald-50',
    absent: 'border-amber-200 bg-amber-50',
    gone: 'border-red-200 bg-red-50',
    new: 'border-purple-200 bg-purple-50',
  }

  return (
    <div className={`rounded-xl border p-4 transition-all ${statusColors[student.status]}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${student.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
          {student.firstName[0]}{student.lastName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 text-sm">{student.firstName} {student.lastName}</p>
          {student.family && (
            <button onClick={onShowFamily} className="text-xs text-[#00D1FF] hover:underline">
              👨‍👩‍👧 {student.family}
            </button>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          student.status === 'present' ? 'bg-emerald-100 text-emerald-700' :
          student.status === 'absent' ? 'bg-amber-100 text-amber-700' :
          student.status === 'gone' ? 'bg-orange-100 text-orange-600' :
          student.status === 'new' ? 'bg-purple-100 text-purple-700' :
          'bg-slate-100 text-slate-500'
        }`}>
          {student.status === 'present' ? '✅ Présent' :
           student.status === 'absent' ? '⚠️ Absent' :
           student.status === 'gone' ? '❓ Non identifié' :
           student.status === 'new' ? '➕ Nouveau' : '⏳ En attente'}
        </span>
      </div>

      {student.status !== 'pending' && (
        <div className="mt-3 flex gap-2 flex-wrap">
          {student.family && student.familyConfirmed === null && (
            <div className="w-full p-2 bg-white/60 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-2">Famille confirmée ?</p>
              <div className="flex gap-2">
                <button onClick={() => onUpdate({ familyConfirmed: true })}
                  className="flex-1 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200">✅ Oui</button>
                <button onClick={() => onUpdate({ familyConfirmed: false })}
                  className="flex-1 py-1.5 bg-red-100 text-red-600 rounded-lg text-xs font-medium hover:bg-red-200">❌ Non</button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => onUpdate({ bus: !student.bus })}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${student.bus ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
              🚌 Bus
            </button>
            <button onClick={() => onUpdate({ canteen: !student.canteen })}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${student.canteen ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
              🍽️ Cantine
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
