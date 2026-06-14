'use client'

import { useState, useEffect } from 'react'
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { SchoolClass, Student } from '../../_lib/types'

export default function ClassesPage() {
  const { activeYear, uid } = useSchoolYear()
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SchoolClass | null>(null)
  const [redirectClassId, setRedirectClassId] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!activeYear || !uid) return
    const qc = query(collection(db, 'classes'), where('schoolYearId', '==', activeYear.id), where('userId', '==', uid))
    const qs = query(collection(db, 'students'), where('schoolYearId', '==', activeYear.id), where('userId', '==', uid))
    const u1 = onSnapshot(qc, (s) => setClasses(s.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolClass))))
    const u2 = onSnapshot(qs, (s) => setStudents(s.docs.map((d) => ({ id: d.id, ...d.data() } as Student))))
    return () => { u1(); u2() }
  }, [activeYear, uid])

  function studentsInClass(classId: string) {
    return students.filter((s) => s.classId === classId)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const affected = studentsInClass(deleteTarget.id)
    if (affected.length > 0 && !redirectClassId) return
    setDeleting(true)
    setDeleteTarget(null)
    try {
      if (affected.length > 0) {
        await Promise.all(affected.map((s) => updateDoc(doc(db, 'students', s.id), { classId: redirectClassId })))
      }
      await deleteDoc(doc(db, 'classes', deleteTarget.id))
    } finally {
      setDeleting(false)
    }
  }

  if (!activeYear) {
    return <div className="p-8"><p className="text-slate-500 text-sm">Aucune année scolaire active.</p></div>
  }

  const otherClasses = deleteTarget ? classes.filter((c) => c.id !== deleteTarget.id) : []

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Classes</h1>
          <p className="text-slate-500 text-sm mt-1">Gérez les classes de votre établissement</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter une classe
          </button>
        )}
      </div>

      <div className="space-y-3">
        {classes.map((cls) => (
          <ClassCard
            key={cls.id}
            cls={cls}
            studentCount={studentsInClass(cls.id).length}
            schoolYearId={activeYear.id}
            onDelete={() => { setDeleteTarget(cls); setRedirectClassId('') }}
          />
        ))}

        {showAdd && (
          <AddClassCard
            schoolYearId={activeYear.id}
            uid={uid ?? ''}
            onDone={() => setShowAdd(false)}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-sm w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Supprimer la classe</h2>
            {studentsInClass(deleteTarget.id).length > 0 ? (
              <>
                <p className="text-slate-600 text-sm mb-4">
                  La classe <strong>{deleteTarget.name}</strong> contient{' '}
                  <strong>{studentsInClass(deleteTarget.id).length} élève(s)</strong>.
                  Choisissez une classe de destination avant de supprimer.
                </p>
                <select
                  value={redirectClassId}
                  onChange={(e) => setRedirectClassId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] mb-4"
                >
                  <option value="">— Choisir une classe —</option>
                  {otherClasses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-slate-600 text-sm mb-4">
                Voulez-vous supprimer la classe <strong>{deleteTarget.name}</strong> ?
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
                Annuler
              </button>
              <button
                onClick={confirmDelete}
                disabled={(studentsInClass(deleteTarget.id).length > 0 && !redirectClassId) || deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-40"
              >
                {deleting ? '…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ClassCard({ cls, studentCount, schoolYearId, onDelete }: {
  cls: SchoolClass; studentCount: number; schoolYearId: string; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cls.name)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    setError('')
    setEditing(false)
    try {
      await updateDoc(doc(db, 'classes', cls.id), { name: name.trim() })
    } catch {
      setError('Erreur lors de la sauvegarde.')
      setEditing(true)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-[#00D1FF]/30 p-4 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom de la classe"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setError('') } }}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => { setEditing(false); setError('') }} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">Annuler</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center justify-between">
      <div>
        <p className="font-semibold text-slate-900 text-sm">{cls.name}</p>
        <p className="text-slate-500 text-xs mt-0.5">{studentCount} élève{studentCount !== 1 ? 's' : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => { setName(cls.name); setError(''); setEditing(true) }} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-50 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button onClick={onDelete} className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function AddClassCard({ schoolYearId, uid, onDone, onCancel }: {
  schoolYearId: string; uid: string; onDone: () => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    setError('')
    onDone()
    try {
      await addDoc(collection(db, 'classes'), { name: name.trim(), schoolYearId, userId: uid })
    } catch {
      setError('Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#00D1FF]/30 p-4 space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom de la classe (ex: CP, CE1, 6ème…)"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">Annuler</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] disabled:opacity-60">
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}