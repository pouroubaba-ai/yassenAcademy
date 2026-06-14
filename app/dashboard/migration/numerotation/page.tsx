'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, updateDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useAuth } from '../../../_lib/auth-context'
import Link from 'next/link'
import phoneContactsRaw from '../../../../public/phone-contacts.json'

interface PhoneContact {
  name: string
  phone: string | null
}
const phoneContacts: PhoneContact[] = phoneContactsRaw

interface MigrationStudent {
  id: string
  sessionId: string
  firstName: string
  lastName: string
  className: string
  gender: string
  family: string | null
  status: string
  addedManually: boolean
  phone?: string | null
  phoneManuel?: string | null
}

interface FamilyRow {
  name: string
  students: MigrationStudent[]
  phone?: string | null
  phoneManuel?: string | null
  phoneSearch: string
  showSuggestions: boolean
  suggestions: PhoneContact[]
}

function normalize(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

function searchContacts(q: string): PhoneContact[] {
  if (!q.trim()) return []
  const nq = normalize(q)
  const words = nq.split(' ').filter(Boolean)
  return phoneContacts
    .filter(c => {
      const nc = normalize(c.name)
      return words.every(w => nc.includes(w))
    })
    .slice(0, 5)
}

function formatPhone(p: string | null | undefined) {
  if (!p) return null
  const clean = p.replace(/\s+/g, '').trim()
  // Déjà un indicatif international
  if (clean.startsWith('+')) return clean
  if (clean.startsWith('00')) return '+' + clean.slice(2)
  // Numéro local Congo → +242
  return '+242' + clean
}

export default function NumerotationPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'familles' | 'eleves'>('familles')
  const [familyRows, setFamilyRows] = useState<Record<string, FamilyRow>>({})
  const [studentRows, setStudentRows] = useState<MigrationStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const sessionsSnap = await getDocs(collection(db, 'migrationSessions'))
    const studs: MigrationStudent[] = []
    await Promise.all(sessionsSnap.docs.map(async sessionDoc => {
      const sSnap = await getDocs(collection(db, 'migrationSessions', sessionDoc.id, 'students'))
      sSnap.docs.forEach(d => studs.push({ id: d.id, sessionId: sessionDoc.id, ...d.data() } as MigrationStudent))
    }))

    // Construire les familles
    const fRows: Record<string, FamilyRow> = {}
    studs.forEach(s => {
      if (s.family) {
        if (!fRows[s.family]) {
          fRows[s.family] = {
            name: s.family,
            students: [],
            phone: undefined,
            phoneManuel: undefined,
            phoneSearch: '',
            showSuggestions: false,
            suggestions: [],
          }
        }
        fRows[s.family].students.push(s)
        if (s.phone && !fRows[s.family].phone) fRows[s.family].phone = s.phone
        if (s.phoneManuel && !fRows[s.family].phoneManuel) fRows[s.family].phoneManuel = s.phoneManuel
      }
    })

    setFamilyRows(fRows)
    setStudentRows(studs)
    setLoading(false)
  }

  // ── Familles helpers ──────────────────────────────────────────────────

  function updateFamily(name: string, patch: Partial<FamilyRow>) {
    setFamilyRows(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }

  function onFamilySearchChange(familyName: string, val: string) {
    const suggestions = searchContacts(val)
    updateFamily(familyName, { phoneSearch: val, suggestions, showSuggestions: true, phone: undefined })
  }

  function selectSuggestion(familyName: string, contact: PhoneContact) {
    updateFamily(familyName, {
      phoneSearch: contact.name,
      phone: contact.phone,
      showSuggestions: false,
      suggestions: [],
    })
  }

  async function saveFamily(familyName: string) {
    const row = familyRows[familyName]
    if (!row) return
    setSaving(familyName)
    const finalPhone = row.phoneManuel || row.phone
    await Promise.all(row.students.map(s =>
      updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
        phone: finalPhone ?? null,
        phoneManuel: row.phoneManuel ?? null,
      })
    ))
    setSaving(null)
  }

  // ── Élèves helpers ────────────────────────────────────────────────────

  function onStudentSearchChange(studentId: string, sessionId: string, val: string) {
    setStudentRows(prev => prev.map(s =>
      s.id === studentId && s.sessionId === sessionId
        ? { ...s, _search: val, _suggestions: searchContacts(val), _showSug: true, phone: undefined } as any
        : s
    ))
  }

  function selectStudentSuggestion(studentId: string, sessionId: string, contact: PhoneContact) {
    setStudentRows(prev => prev.map(s =>
      s.id === studentId && s.sessionId === sessionId
        ? { ...s, phone: contact.phone, _search: contact.name, _showSug: false } as any
        : s
    ))
  }

  async function saveStudent(s: MigrationStudent & any) {
    const finalPhone = s.phoneManuel || s.phone
    await updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
      phone: finalPhone ?? null,
      phoneManuel: s.phoneManuel ?? null,
    })
  }

  // ── Filtres ───────────────────────────────────────────────────────────

  const filteredFamilies = useMemo(() => {
    const rows = Object.values(familyRows)
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(f => f.name.toLowerCase().includes(q))
  }, [familyRows, search])

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return studentRows
    const q = search.toLowerCase()
    return studentRows.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q))
  }, [studentRows, search])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/dashboard/migration" className="hover:text-[#00D1FF]">Migration</Link>
        <span>/</span>
        <span className="text-slate-900 font-semibold">Numéros de téléphone</span>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: 'familles', label: `Familles (${Object.keys(familyRows).length})` },
          { key: 'eleves', label: `Élèves individuels (${studentRows.filter(s => !s.family).length})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => { setTab(key as typeof tab); setSearch('') }}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              tab === key ? 'bg-[#00D1FF] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'familles' ? 'Rechercher une famille…' : 'Rechercher un élève…'}
          className="w-full pl-9 pr-4 py-3 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] bg-white" />
      </div>

      {/* ── FAMILLES ── */}
      {tab === 'familles' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-visible">
          <div className="grid grid-cols-[2fr_2fr_1.5fr_auto] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Famille</span>
            <span>Rechercher dans la liste école</span>
            <span>Numéro trouvé / Manuel</span>
            <span></span>
          </div>

          <div className="divide-y divide-slate-50">
            {filteredFamilies.map(family => {
              const row = familyRows[family.name]
              const effectivePhone = row.phoneManuel || row.phone
              const isSaving = saving === family.name
              return (
                <div key={family.name} className="grid grid-cols-[2fr_2fr_1.5fr_auto] gap-4 px-5 py-4 items-start hover:bg-slate-50/40 transition-colors">
                  {/* Famille */}
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{family.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{family.students.length} élève{family.students.length > 1 ? 's' : ''}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {family.students.slice(0, 4).map(s => (
                        <span key={s.id} className={`text-xs px-1.5 py-0.5 rounded-full ${s.gender === 'F' ? 'bg-pink-50 text-pink-500' : 'bg-blue-50 text-blue-500'}`}>
                          {s.firstName}
                        </span>
                      ))}
                      {family.students.length > 4 && <span className="text-xs text-slate-400">+{family.students.length - 4}</span>}
                    </div>
                  </div>

                  {/* Recherche */}
                  <div className="relative">
                    <input
                      value={row.phoneSearch}
                      onChange={e => onFamilySearchChange(family.name, e.target.value)}
                      onFocus={() => updateFamily(family.name, { showSuggestions: true })}
                      onBlur={() => setTimeout(() => updateFamily(family.name, { showSuggestions: false }), 150)}
                      placeholder="Écrire le nom pour chercher…"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    />
                    {row.showSuggestions && row.suggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                        {row.suggestions.map((c, i) => (
                          <button key={i} onMouseDown={() => selectSuggestion(family.name, c)}
                            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#00D1FF]/5 text-left transition-colors">
                            <span className="text-sm text-slate-900">{c.name}</span>
                            {c.phone
                              ? <span className="text-xs text-[#00D1FF] font-mono">{formatPhone(c.phone)}</span>
                              : <span className="text-xs text-slate-400 italic">Pas de numéro</span>
                            }
                          </button>
                        ))}
                      </div>
                    )}
                    {row.phoneSearch && row.suggestions.length === 0 && row.showSuggestions && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 px-3 py-2.5">
                        <p className="text-sm text-slate-400 italic">Aucun résultat</p>
                      </div>
                    )}
                  </div>

                  {/* Numéro */}
                  <div className="space-y-2">
                    {/* Résultat auto */}
                    {row.phone !== undefined && (
                      <div className={`px-3 py-1.5 rounded-lg text-xs font-mono ${row.phone ? 'bg-[#00D1FF]/10 text-[#00D1FF] font-bold' : 'bg-amber-50 text-amber-600 italic'}`}>
                        {row.phone ? formatPhone(row.phone) : '⚠️ Numéro non disponible'}
                      </div>
                    )}
                    {/* Manuel */}
                    <input
                      value={row.phoneManuel ?? ''}
                      onChange={e => updateFamily(family.name, { phoneManuel: e.target.value })}
                      placeholder="Saisir manuellement…"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    />
                    {effectivePhone && (
                      <p className="text-xs text-slate-400">→ {formatPhone(effectivePhone)}</p>
                    )}
                  </div>

                  {/* Sauver */}
                  <button onClick={() => saveFamily(family.name)} disabled={isSaving}
                    className={`mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      isSaving ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#00D1FF] text-white hover:bg-[#00B8E6]'
                    }`}>
                    {isSaving ? '…' : 'Sauver'}
                  </button>
                </div>
              )
            })}
            {filteredFamilies.length === 0 && (
              <p className="text-center text-slate-400 text-sm py-8">Aucune famille trouvée</p>
            )}
          </div>
        </div>
      )}

      {/* ── ÉLÈVES SANS FAMILLE ── */}
      {tab === 'eleves' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-visible">
          <div className="grid grid-cols-[2fr_2fr_1.5fr_auto] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Élève</span>
            <span>Rechercher dans la liste école</span>
            <span>Numéro trouvé / Manuel</span>
            <span></span>
          </div>

          <div className="divide-y divide-slate-50">
            {filteredStudents.filter(s => !s.family).map((s: any) => {
              const effectivePhone = s.phoneManuel || s.phone
              return (
                <div key={`${s.sessionId}-${s.id}`} className="grid grid-cols-[2fr_2fr_1.5fr_auto] gap-4 px-5 py-4 items-start hover:bg-slate-50/40 transition-colors">
                  {/* Élève */}
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                      {s.firstName[0]}{s.lastName[0]}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{s.firstName} {s.lastName}</p>
                      <p className="text-xs text-slate-400">{s.className}</p>
                    </div>
                  </div>

                  {/* Recherche */}
                  <div className="relative">
                    <input
                      value={s._search ?? ''}
                      onChange={e => onStudentSearchChange(s.id, s.sessionId, e.target.value)}
                      onFocus={() => setStudentRows(prev => prev.map(p => p.id === s.id && p.sessionId === s.sessionId ? { ...p, _showSug: true } as any : p))}
                      onBlur={() => setTimeout(() => setStudentRows(prev => prev.map(p => p.id === s.id && p.sessionId === s.sessionId ? { ...p, _showSug: false } as any : p)), 150)}
                      placeholder="Écrire le nom pour chercher…"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    />
                    {s._showSug && s._suggestions?.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                        {s._suggestions.map((c: PhoneContact, i: number) => (
                          <button key={i} onMouseDown={() => selectStudentSuggestion(s.id, s.sessionId, c)}
                            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#00D1FF]/5 text-left transition-colors">
                            <span className="text-sm text-slate-900">{c.name}</span>
                            {c.phone
                              ? <span className="text-xs text-[#00D1FF] font-mono">{formatPhone(c.phone)}</span>
                              : <span className="text-xs text-slate-400 italic">Pas de numéro</span>
                            }
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Numéro */}
                  <div className="space-y-2">
                    {s.phone !== undefined && (
                      <div className={`px-3 py-1.5 rounded-lg text-xs font-mono ${s.phone ? 'bg-[#00D1FF]/10 text-[#00D1FF] font-bold' : 'bg-amber-50 text-amber-600 italic'}`}>
                        {s.phone ? formatPhone(s.phone) : '⚠️ Numéro non disponible'}
                      </div>
                    )}
                    <input
                      value={s.phoneManuel ?? ''}
                      onChange={e => setStudentRows(prev => prev.map(p => p.id === s.id && p.sessionId === s.sessionId ? { ...p, phoneManuel: e.target.value } as any : p))}
                      placeholder="Saisir manuellement…"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    />
                  </div>

                  {/* Sauver */}
                  <button onClick={() => saveStudent(s)}
                    className="mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#00D1FF] text-white hover:bg-[#00B8E6] transition-colors">
                    Sauver
                  </button>
                </div>
              )
            })}
            {filteredStudents.filter(s => !s.family).length === 0 && (
              <p className="text-center text-slate-400 text-sm py-8">Tous les élèves sans famille ont un numéro</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
