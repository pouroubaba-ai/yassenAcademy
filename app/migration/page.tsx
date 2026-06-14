'use client'

import { useState, useEffect } from 'react'
import { collection, getDocs, query, where, doc, updateDoc, addDoc } from 'firebase/firestore'
import { db } from '../_lib/firebase'

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

type Screen = 'login' | 'list' | 'student'

export default function TeacherMigrationPage() {
  const [screen, setScreen] = useState<Screen>('login')
  const [code, setCode] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [className, setClassName] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [allFamilyStudents, setAllFamilyStudents] = useState<Record<string, Student[]>>({})
  const [selected, setSelected] = useState<Student | null>(null)
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAddNew, setShowAddNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGender, setNewGender] = useState<'M' | 'F'>('M')
  const [newFamily, setNewFamily] = useState('')
  const [familyModal, setFamilyModal] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending'>('pending')

  async function login() {
    if (!code.trim()) return
    setLoading(true)
    setLoginError('')
    try {
      const snap = await getDocs(query(collection(db, 'migrationSessions'), where('code', '==', code.trim().toUpperCase())))
      if (snap.empty) { setLoginError('Code incorrect. Vérifiez et réessayez.'); setLoading(false); return }

      const sessionDoc = snap.docs[0]
      const sid = sessionDoc.id
      const data = sessionDoc.data()
      setSessionId(sid)
      setClassName(data.className)

      const studSnap = await getDocs(collection(db, 'migrationSessions', sid, 'students'))
      const studs = studSnap.docs.map(d => ({ id: d.id, ...d.data() } as Student))
      setStudents(studs)

      // Grouper par famille
      const families: Record<string, Student[]> = {}
      studs.forEach(s => {
        if (s.family) {
          if (!families[s.family]) families[s.family] = []
          families[s.family].push(s)
        }
      })
      setAllFamilyStudents(families)
      setScreen('list')
    } catch (e) {
      setLoginError('Erreur de connexion. Vérifiez votre connexion internet.')
    } finally {
      setLoading(false)
    }
  }

  async function updateStudent(updates: Partial<Student>) {
    if (!selected) return
    setSaving(true)
    const updated = { ...selected, ...updates }
    setStudents(prev => prev.map(s => s.id === selected.id ? updated : s))
    setSelected(updated)
    await updateDoc(doc(db, 'migrationSessions', sessionId, 'students', selected.id), updates)
    setSaving(false)
  }

  async function addNewStudent() {
    if (!newName.trim()) return
    setSaving(true)
    const parts = newName.trim().split(' ')
    const firstName = parts[0]
    const lastName = parts.slice(1).join(' ')
    const newStud: Omit<Student, 'id'> = {
      firstName, lastName, className, gender: newGender,
      family: newFamily.trim() || null,
      status: 'new', familyConfirmed: null,
      bus: false, canteen: false, addedManually: true,
    }
    const ref = await addDoc(collection(db, 'migrationSessions', sessionId, 'students'), newStud)
    const withId = { id: ref.id, ...newStud }
    setStudents(prev => [...prev, withId])
    setNewName(''); setNewGender('M'); setNewFamily('')
    setShowAddNew(false)
    setSaving(false)
  }

  const pending = students.filter(s => s.status === 'pending').length
  const done = students.length - pending
  const displayed = filter === 'pending' ? students.filter(s => s.status === 'pending') : students

  // ÉCRAN LOGIN
  if (screen === 'login') return (
    <div className="min-h-screen bg-gradient-to-b from-[#00D1FF]/10 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#00D1FF] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl">🏫</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Yassen Academy</h1>
          <p className="text-slate-500 text-sm mt-1">Vérification des élèves</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">Code de votre classe</label>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && login()}
            placeholder="Ex: CE12345"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 text-lg font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#00D1FF] uppercase"
            autoFocus
          />
          {loginError && <p className="text-red-500 text-sm mt-2 text-center">{loginError}</p>}
          <button onClick={login} disabled={loading || !code.trim()}
            className="mt-4 w-full py-3.5 bg-[#00D1FF] text-white rounded-xl font-bold text-lg hover:bg-[#00b8e0] disabled:opacity-60 transition-colors">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Connexion…
              </span>
            ) : 'Se connecter'}
          </button>
        </div>
      </div>
    </div>
  )

  // ÉCRAN LISTE
  if (screen === 'list') return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-slate-900">{className}</h1>
            <p className="text-xs text-slate-500">{done}/{students.length} traités</p>
          </div>
          <button onClick={() => setShowAddNew(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-100 text-purple-700 rounded-xl text-sm font-semibold">
            ➕ Nouveau
          </button>
        </div>
        {/* Barre de progression */}
        <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5">
          <div className="bg-[#00D1FF] h-1.5 rounded-full transition-all" style={{ width: `${students.length > 0 ? (done / students.length) * 100 : 0}%` }} />
        </div>
        {/* Filtres */}
        <div className="flex gap-2 mt-3">
          <button onClick={() => setFilter('pending')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium ${filter === 'pending' ? 'bg-[#00D1FF] text-white' : 'bg-slate-100 text-slate-600'}`}>
            En attente ({pending})
          </button>
          <button onClick={() => setFilter('all')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium ${filter === 'all' ? 'bg-[#00D1FF] text-white' : 'bg-slate-100 text-slate-600'}`}>
            Tous ({students.length})
          </button>
        </div>
      </div>

      {/* Liste */}
      <div className="p-4 space-y-2 pb-24">
        {pending === 0 && filter === 'pending' && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-bold text-slate-900">Classe terminée !</p>
            <p className="text-slate-500 text-sm mt-1">Tous les élèves ont été traités.</p>
          </div>
        )}
        {displayed.map(s => (
          <button key={s.id} onClick={() => { setSelected(s); setScreen('student') }}
            className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
              s.status === 'present' ? 'bg-emerald-50 border-emerald-200' :
              s.status === 'absent' ? 'bg-amber-50 border-amber-200' :
              s.status === 'gone' ? 'bg-orange-50 border-orange-200' :
              s.status === 'new' ? 'bg-purple-50 border-purple-200' :
              'bg-white border-slate-200'
            }`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
              {s.firstName[0]}{s.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900">{s.firstName} {s.lastName}</p>
              {s.family && <p className="text-xs text-slate-400 truncate">{s.family}</p>}
            </div>
            <span className="text-xl flex-shrink-0">
              {s.status === 'present' ? '✅' :
               s.status === 'absent' ? '⚠️' :
               s.status === 'gone' ? '❓' :
               s.status === 'new' ? '➕' : '⏳'}
            </span>
          </button>
        ))}
      </div>

      {/* Modal ajout élève */}
      {showAddNew && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setShowAddNew(false)}>
          <div className="bg-white rounded-t-2xl w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-4">Ajouter un élève</h3>
            <div className="space-y-3">
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Prénom Nom"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
              <div className="flex gap-2">
                {(['M', 'F'] as const).map(g => (
                  <button key={g} onClick={() => setNewGender(g)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${newGender === g ? (g === 'M' ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-pink-100 border-pink-400 text-pink-700') : 'border-slate-200 text-slate-500'}`}>
                    {g === 'M' ? '👦 Garçon' : '👧 Fille'}
                  </button>
                ))}
              </div>
              <input value={newFamily} onChange={e => setNewFamily(e.target.value)}
                placeholder="Famille (optionnel)"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAddNew(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium">Annuler</button>
              <button onClick={addNewStudent} disabled={!newName.trim() || saving}
                className="flex-1 py-3 rounded-xl bg-purple-600 text-white font-bold disabled:opacity-60">
                {saving ? '…' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ÉCRAN ÉLÈVE
  if (screen === 'student' && selected) return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-4 sticky top-0 z-10">
        <button onClick={() => { setScreen('list'); setSelected(null) }}
          className="flex items-center gap-2 text-[#00D1FF] text-sm font-medium mb-3">
          ← Retour à {className}
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-lg ${selected.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
            {selected.firstName[0]}{selected.lastName[0]}
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-lg">{selected.firstName} {selected.lastName}</h1>
            <p className="text-slate-500 text-sm">{className} · {selected.gender === 'F' ? 'Fille' : 'Garçon'}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 pb-24">
        {/* Statut */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <p className="text-sm font-bold text-slate-700 mb-3">Cet élève est :</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { status: 'present' as const, label: 'Présent', emoji: '✅', color: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
              { status: 'absent' as const, label: 'Absent', emoji: '⚠️', color: 'border-amber-400 bg-amber-50 text-amber-700' },
              { status: 'gone' as const, label: 'Non identifié', emoji: '❓', color: 'border-red-400 bg-red-50 text-red-600' },
            ].map(({ status, label, emoji, color }) => (
              <button key={status} onClick={() => updateStudent({ status })}
                className={`py-4 rounded-2xl border-2 text-sm font-bold flex flex-col items-center gap-1 transition-all ${
                  selected.status === status ? color : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}>
                <span className="text-2xl">{emoji}</span>
                {label}
              </button>
            ))}
            <button onClick={() => updateStudent({ status: 'pending' })}
              className={`py-4 rounded-2xl border-2 text-sm font-bold flex flex-col items-center gap-1 transition-all ${
                selected.status === 'pending' ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}>
              <span className="text-2xl">⏳</span>
              En attente
            </button>
          </div>
          {saving && <p className="text-xs text-slate-400 text-center mt-2">Enregistrement…</p>}
        </div>

        {/* Famille */}
        {selected.family && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-700 mb-1">Famille déclarée</p>
            <p className="text-[#00D1FF] font-semibold mb-3">{selected.family}</p>

            <button onClick={() => setFamilyModal(true)}
              className="w-full py-2.5 bg-[#00D1FF]/10 text-[#00D1FF] rounded-xl text-sm font-semibold mb-3">
              👨‍👩‍👧 Voir les autres membres
            </button>

            <p className="text-sm font-medium text-slate-600 mb-2">L'élève confirme appartenir à cette famille ?</p>
            <div className="flex gap-2">
              <button onClick={() => updateStudent({ familyConfirmed: true })}
                className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                  selected.familyConfirmed === true ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'border-slate-200 text-slate-500'
                }`}>✅ Oui</button>
              <button onClick={() => updateStudent({ familyConfirmed: false })}
                className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                  selected.familyConfirmed === false ? 'bg-red-100 border-red-400 text-red-600' : 'border-slate-200 text-slate-500'
                }`}>❌ Non</button>
            </div>
          </div>
        )}

        {/* Bus & Cantine */}
        {selected.status !== 'pending' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-700 mb-3">Services</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => updateStudent({ bus: !selected.bus })}
                className={`py-4 rounded-2xl border-2 text-sm font-bold flex flex-col items-center gap-1 transition-all ${
                  selected.bus ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}>
                <span className="text-2xl">🚌</span>
                Bus {selected.bus ? '✓' : ''}
              </button>
              <button onClick={() => updateStudent({ canteen: !selected.canteen })}
                className={`py-4 rounded-2xl border-2 text-sm font-bold flex flex-col items-center gap-1 transition-all ${
                  selected.canteen ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}>
                <span className="text-2xl">🍽️</span>
                Cantine {selected.canteen ? '✓' : ''}
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3">
          {students.findIndex(s => s.id === selected.id) > 0 && (
            <button onClick={() => {
              const idx = students.findIndex(s => s.id === selected.id)
              const prev = students[idx - 1]
              setSelected(prev)
            }} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">
              ← Précédent
            </button>
          )}
          {students.findIndex(s => s.id === selected.id) < students.length - 1 && (
            <button onClick={() => {
              const idx = students.findIndex(s => s.id === selected.id)
              const next = students[idx + 1]
              setSelected(next)
            }} className="flex-1 py-3 rounded-xl bg-[#00D1FF] text-white text-sm font-bold">
              Suivant →
            </button>
          )}
        </div>
      </div>

      {/* Modal famille */}
      {familyModal && selected.family && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setFamilyModal(false)}>
          <div className="bg-white rounded-t-2xl w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-1">{selected.family}</h3>
            <p className="text-xs text-slate-400 mb-4">Demandez à l'élève s'il connaît ces enfants</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(allFamilyStudents[selected.family] ?? []).map(fs => (
                <div key={fs.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${fs.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                    {fs.firstName[0]}{fs.lastName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{fs.firstName} {fs.lastName}</p>
                    <p className="text-xs text-slate-500">{fs.className}</p>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setFamilyModal(false)} className="mt-4 w-full py-3 rounded-xl border border-slate-200 text-slate-700 font-medium">Fermer</button>
          </div>
        </div>
      )}
    </div>
  )

  return null
}
