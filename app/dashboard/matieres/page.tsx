'use client'

import { useState, useEffect } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { Subject } from '../../_lib/types'

export default function MatieresPage() {
  const { uid } = useSchoolYear()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      query(collection(db, 'subjects'), where('userId', '==', uid)),
      (snap) => setSubjects(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Subject)))
    )
  }, [uid])

  async function handleDelete(id: string, subjectName: string) {
    if (!confirm(`Supprimer la matière "${subjectName}" ?`)) return
    await deleteDoc(doc(db, 'subjects', id))
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Matières</h1>
          <p className="text-slate-500 text-sm mt-1">Matières enseignées dans l'établissement</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter une matière
          </button>
        )}
      </div>

      {subjects.length === 0 && !showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center">
          <p className="text-slate-500 text-sm">Aucune matière. Ajoutez-en une pour commencer.</p>
        </div>
      )}

      <div className="space-y-3">
        {subjects.map((subject) => (
          <SubjectCard
            key={subject.id}
            subject={subject}
            onDelete={() => handleDelete(subject.id, subject.name)}
          />
        ))}

        {showAdd && uid && (
          <AddSubjectCard
            uid={uid}
            onDone={() => setShowAdd(false)}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </div>
    </div>
  )
}

function SubjectCard({ subject, onDelete }: { subject: Subject; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(subject.name)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    setError('')
    setEditing(false)
    try {
      await updateDoc(doc(db, 'subjects', subject.id), { name: name.trim() })
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
          placeholder="Nom de la matière"
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
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#00D1FF]/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-[#00D1FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <p className="font-semibold text-slate-900 text-sm">{subject.name}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => { setName(subject.name); setError(''); setEditing(true) }} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-50 transition-colors">
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

function AddSubjectCard({ uid, onDone, onCancel }: { uid: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    setError('')
    onDone()
    try {
      await addDoc(collection(db, 'subjects'), { name: name.trim(), userId: uid })
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
        placeholder="Nom de la matière (ex: Mathématiques, Français…)"
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
