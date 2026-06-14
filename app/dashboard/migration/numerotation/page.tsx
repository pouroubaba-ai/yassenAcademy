'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useAuth } from '../../../_lib/auth-context'
import Link from 'next/link'
import phoneContactsRaw from '../../../../public/phone-contacts.json'

interface PhoneContact { name: string; phone: string | null }
const phoneContacts: PhoneContact[] = phoneContactsRaw as PhoneContact[]

interface MigrationStudent {
  id: string; sessionId: string
  firstName: string; lastName: string; className: string; gender: string
  family: string | null; status: string; addedManually: boolean
  grandBus: boolean; petitBus: boolean; canteen: boolean
  busReduction: number | null; canteenReduction: number | null
  phone?: string | null; phoneManuel?: string | null
}

interface StudentLocal extends MigrationStudent {
  _search: string
  _suggestions: PhoneContact[]
  _showSug: boolean
  _phoneSource: 'search' | 'manual' | null
  _dirty: boolean
  _saving: boolean
}

interface FamilyRow {
  name: string
  students: StudentLocal[]
  phoneSearch: string
  phone: string | null
  phoneManuel: string | null
  phoneSource: 'search' | 'manual' | null
  showSuggestions: boolean
  suggestions: PhoneContact[]
  busReduction: number | null
  canteenReduction: number | null
  saving: boolean
}

function normalize(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').trim()
}

function searchContacts(q: string): PhoneContact[] {
  if (!q.trim()) return []
  const words = normalize(q).split(' ').filter(Boolean)
  return phoneContacts
    .filter(c => { const nc = normalize(c.name); return words.every(w => nc.includes(w)) })
    .slice(0, 5)
}

function formatPhone(p: string | null | undefined) {
  if (!p) return null
  const clean = p.replace(/\s+/g, '').trim()
  if (clean.startsWith('+')) return clean
  if (clean.startsWith('00')) return '+' + clean.slice(2)
  return '+242' + clean
}

type ServiceModal = { familyName: string; service: 'bus' | 'canteen' } | null

export default function NumerotationPage() {
  useAuth()
  const [tab, setTab] = useState<'familles' | 'eleves'>('familles')
  const [familyRows, setFamilyRows] = useState<Record<string, FamilyRow>>({})
  const [studentRows, setStudentRows] = useState<StudentLocal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [serviceModal, setServiceModal] = useState<ServiceModal>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const sessionsSnap = await getDocs(collection(db, 'migrationSessions'))
    const studs: MigrationStudent[] = []
    await Promise.all(sessionsSnap.docs.map(async sessionDoc => {
      const sSnap = await getDocs(collection(db, 'migrationSessions', sessionDoc.id, 'students'))
      sSnap.docs.forEach(d => {
        const data = d.data()
        studs.push({
          id: d.id, sessionId: sessionDoc.id,
          firstName: data.firstName ?? '', lastName: data.lastName ?? '',
          className: data.className ?? '', gender: data.gender ?? '',
          family: data.family ?? null, status: data.status ?? 'pending',
          addedManually: data.addedManually ?? false,
          grandBus: data.grandBus ?? false, petitBus: data.petitBus ?? false,
          canteen: data.canteen ?? false,
          busReduction: data.busReduction ?? null,
          canteenReduction: data.canteenReduction ?? null,
          phone: data.phone ?? null, phoneManuel: data.phoneManuel ?? null,
        })
      })
    }))

    const locals: StudentLocal[] = studs.map(s => ({
      ...s,
      _search: '',
      _suggestions: [],
      _showSug: false,
      _phoneSource: s.phone ? 'search' : (s.phoneManuel ? 'manual' : null),
      _dirty: false,
      _saving: false,
    }))

    const fRows: Record<string, FamilyRow> = {}
    locals.forEach(s => {
      if (!s.family) return
      if (!fRows[s.family]) {
        fRows[s.family] = {
          name: s.family, students: [],
          phoneSearch: '', phone: null, phoneManuel: null, phoneSource: null,
          showSuggestions: false, suggestions: [],
          busReduction: null, canteenReduction: null, saving: false,
        }
      }
      fRows[s.family].students.push(s)
      if (!fRows[s.family].phone && s.phone) fRows[s.family].phone = s.phone
      if (!fRows[s.family].phoneManuel && s.phoneManuel) fRows[s.family].phoneManuel = s.phoneManuel
      if (s.busReduction !== null && fRows[s.family].busReduction === null) fRows[s.family].busReduction = s.busReduction
      if (s.canteenReduction !== null && fRows[s.family].canteenReduction === null) fRows[s.family].canteenReduction = s.canteenReduction
    })
    Object.values(fRows).forEach(f => {
      if (f.phone) f.phoneSource = 'search'
      else if (f.phoneManuel) f.phoneSource = 'manual'
    })

    setFamilyRows(fRows)
    setStudentRows(locals.filter(s => !s.family))
    setLoading(false)
  }

  // ── Family helpers ──────────────────────────────────────────────────

  function updateFamily(name: string, patch: Partial<FamilyRow>) {
    setFamilyRows(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }

  function updateFamilyStudent(familyName: string, sid: string, ssid: string, patch: Partial<StudentLocal>) {
    setFamilyRows(prev => ({
      ...prev,
      [familyName]: {
        ...prev[familyName],
        students: prev[familyName].students.map(s =>
          s.id === sid && s.sessionId === ssid ? { ...s, ...patch } : s
        ),
      },
    }))
  }

  function onFamilySearchChange(name: string, val: string) {
    updateFamily(name, { phoneSearch: val, suggestions: searchContacts(val), showSuggestions: true, phone: null, phoneSource: null })
  }

  function selectFamilySuggestion(name: string, c: PhoneContact) {
    updateFamily(name, { phoneSearch: c.name, phone: c.phone, phoneManuel: null, phoneSource: 'search', showSuggestions: false, suggestions: [] })
  }

  function clearFamilySearch(name: string) {
    updateFamily(name, { phoneSearch: '', phone: null, phoneSource: null, showSuggestions: false, suggestions: [] })
  }

  async function saveFamily(name: string) {
    const row = familyRows[name]
    if (!row) return
    updateFamily(name, { saving: true })
    const ph = row.phoneSource === 'search' ? row.phone : null
    const phM = row.phoneSource === 'manual' ? row.phoneManuel : null
    await Promise.all(row.students.map(s =>
      updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
        phone: ph ?? null, phoneManuel: phM ?? null,
        busReduction: row.busReduction ?? null,
        canteenReduction: row.canteenReduction ?? null,
      })
    ))
    updateFamily(name, { saving: false })
  }

  async function saveFamilyServices(name: string) {
    const row = familyRows[name]
    if (!row) return
    await Promise.all(row.students.map(s =>
      updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
        grandBus: s.grandBus, petitBus: s.petitBus, canteen: s.canteen,
      })
    ))
  }

  // ── Student helpers ─────────────────────────────────────────────────

  function patchStudent(sid: string, ssid: string, patch: Partial<StudentLocal>) {
    setStudentRows(prev => prev.map(s =>
      s.id === sid && s.sessionId === ssid ? { ...s, ...patch, _dirty: true } : s
    ))
  }

  function onStudentSearchChange(sid: string, ssid: string, val: string) {
    setStudentRows(prev => prev.map(s =>
      s.id === sid && s.sessionId === ssid
        ? { ...s, _search: val, _suggestions: searchContacts(val), _showSug: true, phone: null, _phoneSource: null }
        : s
    ))
  }

  function selectStudentSuggestion(sid: string, ssid: string, c: PhoneContact) {
    setStudentRows(prev => prev.map(s =>
      s.id === sid && s.sessionId === ssid
        ? { ...s, phone: c.phone, phoneManuel: null, _search: c.name, _showSug: false, _phoneSource: 'search', _dirty: true }
        : s
    ))
  }

  function clearStudentSearch(sid: string, ssid: string) {
    setStudentRows(prev => prev.map(s =>
      s.id === sid && s.sessionId === ssid
        ? { ...s, phone: null, _search: '', _phoneSource: null }
        : s
    ))
  }

  async function saveStudent(s: StudentLocal) {
    setStudentRows(prev => prev.map(p =>
      p.id === s.id && p.sessionId === s.sessionId ? { ...p, _saving: true } : p
    ))
    await updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
      phone: s._phoneSource === 'search' ? (s.phone ?? null) : null,
      phoneManuel: s._phoneSource === 'manual' ? (s.phoneManuel ?? null) : null,
      grandBus: s.grandBus, petitBus: s.petitBus, canteen: s.canteen,
      busReduction: s.busReduction ?? null, canteenReduction: s.canteenReduction ?? null,
    })
    setStudentRows(prev => prev.map(p =>
      p.id === s.id && p.sessionId === s.sessionId ? { ...p, _saving: false, _dirty: false } : p
    ))
  }

  // ── Filters ─────────────────────────────────────────────────────────

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

  // ── Phone section (shared UI) ───────────────────────────────────────

  function PhoneSection({ phoneSearch, phoneSource, phone, phoneManuel, showSuggestions, suggestions, onSearchChange, onSelectSuggestion, onClearSearch, onManualChange, onFocus, onBlur }: {
    phoneSearch: string; phoneSource: 'search' | 'manual' | null
    phone: string | null; phoneManuel: string | null
    showSuggestions: boolean; suggestions: PhoneContact[]
    onSearchChange: (v: string) => void
    onSelectSuggestion: (c: PhoneContact) => void
    onClearSearch: () => void
    onManualChange: (v: string) => void
    onFocus: () => void; onBlur: () => void
  }) {
    const effectivePhone = phoneSource === 'search' ? phone : phoneManuel
    return (
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Téléphone</p>
        <div className="relative mb-2">
          <input value={phoneSearch} onChange={e => onSearchChange(e.target.value)}
            onFocus={onFocus} onBlur={onBlur}
            placeholder="Chercher dans la liste école…"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
              {suggestions.map((c, i) => (
                <button key={i} onMouseDown={() => onSelectSuggestion(c)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#00D1FF]/5 text-left transition-colors">
                  <span className="text-sm text-slate-900">{c.name}</span>
                  {c.phone
                    ? <span className="text-xs text-[#00D1FF] font-mono">{formatPhone(c.phone)}</span>
                    : <span className="text-xs text-slate-400 italic">Pas de numéro</span>}
                </button>
              ))}
            </div>
          )}
          {showSuggestions && phoneSearch && suggestions.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 px-3 py-2.5">
              <p className="text-sm text-slate-400 italic">Aucun résultat</p>
            </div>
          )}
        </div>
        {phoneSource === 'search' && (
          <div className="flex items-center gap-2 mb-2">
            <span className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-mono ${phone ? 'bg-[#00D1FF]/10 text-[#00D1FF] font-bold' : 'bg-amber-50 text-amber-600 italic'}`}>
              {phone ? formatPhone(phone) : 'Numéro non disponible dans la liste'}
            </span>
            <button onClick={onClearSearch} title="Effacer la sélection"
              className="text-slate-400 hover:text-red-500 transition-colors text-sm">✕</button>
          </div>
        )}
        <input
          value={phoneManuel ?? ''}
          onChange={e => onManualChange(e.target.value)}
          disabled={phoneSource === 'search'}
          placeholder={phoneSource === 'search' ? 'Saisie désactivée (effacer ✕ pour saisir)' : 'Saisir manuellement…'}
          className={`w-full px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
            phoneSource === 'search'
              ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
              : 'border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]'
          }`}
        />
        {effectivePhone && (
          <p className="text-xs text-emerald-600 mt-1 font-mono">✓ {formatPhone(effectivePhone)}</p>
        )}
      </div>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/dashboard/migration" className="hover:text-[#00D1FF]">Migration</Link>
        <span>/</span>
        <span className="text-slate-900 font-semibold">Numéros &amp; Frais</span>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: 'familles', label: `Familles (${Object.keys(familyRows).length})` },
          { key: 'eleves', label: `Élèves individuels (${studentRows.length})` },
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
        <div className="space-y-3">
          {filteredFamilies.map(family => {
            const row = familyRows[family.name]
            const gbCount = row.students.filter(s => s.grandBus).length
            const pbCount = row.students.filter(s => s.petitBus).length
            const ctCount = row.students.filter(s => s.canteen).length
            const hasBus = gbCount + pbCount > 0
            const hasCanteen = ctCount > 0

            return (
              <div key={family.name} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-bold text-slate-900 text-base">{family.name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-xs text-slate-400">{row.students.length} élève{row.students.length > 1 ? 's' : ''}</span>
                      {gbCount > 0 && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">🚌 GB : {gbCount}</span>}
                      {pbCount > 0 && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">🚐 PB : {pbCount}</span>}
                      {ctCount > 0 && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">🍽️ CT : {ctCount}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {row.students.slice(0, 5).map(s => (
                        <span key={s.id} className={`text-xs px-1.5 py-0.5 rounded-full ${s.gender === 'F' ? 'bg-pink-50 text-pink-500' : 'bg-blue-50 text-blue-500'}`}>
                          {s.firstName}
                        </span>
                      ))}
                      {row.students.length > 5 && <span className="text-xs text-slate-400">+{row.students.length - 5}</span>}
                    </div>
                  </div>
                  <button onClick={() => saveFamily(family.name)} disabled={row.saving}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
                      row.saving ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#00D1FF] text-white hover:bg-[#00B8E6]'
                    }`}>
                    {row.saving ? '…' : 'Sauver'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-5">
                  {/* Téléphone */}
                  <PhoneSection
                    phoneSearch={row.phoneSearch}
                    phoneSource={row.phoneSource}
                    phone={row.phone}
                    phoneManuel={row.phoneManuel}
                    showSuggestions={row.showSuggestions}
                    suggestions={row.suggestions}
                    onSearchChange={v => onFamilySearchChange(family.name, v)}
                    onSelectSuggestion={c => selectFamilySuggestion(family.name, c)}
                    onClearSearch={() => clearFamilySearch(family.name)}
                    onManualChange={v => updateFamily(family.name, { phoneManuel: v, phoneSource: 'manual' })}
                    onFocus={() => updateFamily(family.name, { showSuggestions: true })}
                    onBlur={() => setTimeout(() => updateFamily(family.name, { showSuggestions: false }), 150)}
                  />

                  {/* Réduction Bus */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Réduction Bus</p>
                    {hasBus ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100"
                            value={row.busReduction ?? ''}
                            onChange={e => updateFamily(family.name, { busReduction: e.target.value ? Number(e.target.value) : null })}
                            placeholder="0"
                            className="w-20 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                          <span className="text-sm text-slate-500">%</span>
                        </div>
                        <p className="text-xs text-slate-400">S'applique à tous les élèves avec bus</p>
                        <button onClick={() => setServiceModal({ familyName: family.name, service: 'bus' })}
                          className="text-xs text-[#00D1FF] hover:underline font-medium">
                          ✏️ Gérer élèves ({gbCount + pbCount})
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 italic">Aucun élève inscrit au bus</p>
                        <button onClick={() => setServiceModal({ familyName: family.name, service: 'bus' })}
                          className="text-xs text-slate-500 hover:text-[#00D1FF] transition-colors">
                          + Inscrire des élèves
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Réduction Cantine */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Réduction Cantine</p>
                    {hasCanteen ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100"
                            value={row.canteenReduction ?? ''}
                            onChange={e => updateFamily(family.name, { canteenReduction: e.target.value ? Number(e.target.value) : null })}
                            placeholder="0"
                            className="w-20 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                          <span className="text-sm text-slate-500">%</span>
                        </div>
                        <p className="text-xs text-slate-400">S'applique à tous les élèves à la cantine</p>
                        <button onClick={() => setServiceModal({ familyName: family.name, service: 'canteen' })}
                          className="text-xs text-[#00D1FF] hover:underline font-medium">
                          ✏️ Gérer élèves ({ctCount})
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 italic">Aucun élève inscrit à la cantine</p>
                        <button onClick={() => setServiceModal({ familyName: family.name, service: 'canteen' })}
                          className="text-xs text-slate-500 hover:text-[#00D1FF] transition-colors">
                          + Inscrire des élèves
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {filteredFamilies.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">Aucune famille trouvée</p>
          )}
        </div>
      )}

      {/* ── ÉLÈVES INDIVIDUELS ── */}
      {tab === 'eleves' && (
        <div className="space-y-3">
          {filteredStudents.map(s => {
            const hasBus = s.grandBus || s.petitBus
            return (
              <div key={`${s.sessionId}-${s.id}`} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                      {s.firstName[0]}{s.lastName[0]}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{s.firstName} {s.lastName}</p>
                      <p className="text-xs text-slate-400">{s.className}</p>
                    </div>
                  </div>
                  <button onClick={() => saveStudent(s)} disabled={s._saving}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
                      s._saving ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#00D1FF] text-white hover:bg-[#00B8E6]'
                    }`}>
                    {s._saving ? '…' : 'Sauver'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-5">
                  {/* Téléphone */}
                  <PhoneSection
                    phoneSearch={s._search}
                    phoneSource={s._phoneSource}
                    phone={s.phone ?? null}
                    phoneManuel={s.phoneManuel ?? null}
                    showSuggestions={s._showSug}
                    suggestions={s._suggestions}
                    onSearchChange={v => onStudentSearchChange(s.id, s.sessionId, v)}
                    onSelectSuggestion={c => selectStudentSuggestion(s.id, s.sessionId, c)}
                    onClearSearch={() => clearStudentSearch(s.id, s.sessionId)}
                    onManualChange={v => patchStudent(s.id, s.sessionId, { phoneManuel: v, _phoneSource: 'manual' } as any)}
                    onFocus={() => setStudentRows(prev => prev.map(p => p.id === s.id && p.sessionId === s.sessionId ? { ...p, _showSug: true } : p))}
                    onBlur={() => setTimeout(() => setStudentRows(prev => prev.map(p => p.id === s.id && p.sessionId === s.sessionId ? { ...p, _showSug: false } : p)), 150)}
                  />

                  {/* Bus */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Bus</p>
                    {hasBus ? (
                      <div className="space-y-2">
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => patchStudent(s.id, s.sessionId, s.grandBus ? { grandBus: false } : { grandBus: true, petitBus: false })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${s.grandBus ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200' : 'bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600'}`}>
                            🚌 Grand Bus
                          </button>
                          <button
                            onClick={() => patchStudent(s.id, s.sessionId, s.petitBus ? { petitBus: false } : { petitBus: true, grandBus: false })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${s.petitBus ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                            🚐 Petit Bus
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100"
                            value={s.busReduction ?? ''}
                            onChange={e => patchStudent(s.id, s.sessionId, { busReduction: e.target.value ? Number(e.target.value) : null })}
                            placeholder="0"
                            className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                          <span className="text-xs text-slate-500">% réduction</span>
                        </div>
                        <button onClick={() => patchStudent(s.id, s.sessionId, { grandBus: false, petitBus: false })}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">
                          ✕ Désinscrire du bus
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 italic">Non inscrit au bus</p>
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => patchStudent(s.id, s.sessionId, { grandBus: true, petitBus: false })}
                            className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 transition-colors">
                            + 🚌 Grand Bus
                          </button>
                          <button onClick={() => patchStudent(s.id, s.sessionId, { petitBus: true, grandBus: false })}
                            className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors">
                            + 🚐 Petit Bus
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cantine */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cantine</p>
                    {s.canteen ? (
                      <div className="space-y-2">
                        <span className="inline-block px-2.5 py-1 rounded-lg text-xs bg-green-100 text-green-700 font-medium ring-2 ring-green-200">🍽️ Inscrit</span>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100"
                            value={s.canteenReduction ?? ''}
                            onChange={e => patchStudent(s.id, s.sessionId, { canteenReduction: e.target.value ? Number(e.target.value) : null })}
                            placeholder="0"
                            className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                          <span className="text-xs text-slate-500">% réduction</span>
                        </div>
                        <button onClick={() => patchStudent(s.id, s.sessionId, { canteen: false })}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">
                          ✕ Désinscrire de la cantine
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 italic">Non inscrit à la cantine</p>
                        <button onClick={() => patchStudent(s.id, s.sessionId, { canteen: true })}
                          className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-700 transition-colors">
                          + 🍽️ Inscrire
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {filteredStudents.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">Aucun élève individuel trouvé</p>
          )}
        </div>
      )}

      {/* ── MODAL GESTION BUS / CANTINE ── */}
      {serviceModal && (() => {
        const row = familyRows[serviceModal.familyName]
        if (!row) return null
        const isBus = serviceModal.service === 'bus'
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setServiceModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-100">
                <h3 className="font-bold text-slate-900 text-lg">
                  {isBus ? '🚌 Gestion Bus' : '🍽️ Gestion Cantine'}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">{serviceModal.familyName}</p>
                <p className="text-xs text-slate-400 mt-1">Cochez ou décochez les élèves</p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {row.students.map(s => (
                  <div key={s.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                        {s.firstName[0]}{s.lastName[0]}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{s.firstName} {s.lastName}</p>
                        <p className="text-xs text-slate-400">{s.className}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isBus ? (
                        <>
                          <button
                            onClick={() => updateFamilyStudent(serviceModal.familyName, s.id, s.sessionId,
                              s.grandBus ? { grandBus: false } : { grandBus: true, petitBus: false }
                            )}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${s.grandBus ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200' : 'bg-slate-100 text-slate-400 hover:bg-blue-50'}`}>
                            🚌 GB
                          </button>
                          <button
                            onClick={() => updateFamilyStudent(serviceModal.familyName, s.id, s.sessionId,
                              s.petitBus ? { petitBus: false } : { petitBus: true, grandBus: false }
                            )}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${s.petitBus ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200' : 'bg-slate-100 text-slate-400 hover:bg-indigo-50'}`}>
                            🚐 PB
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => updateFamilyStudent(serviceModal.familyName, s.id, s.sessionId, { canteen: !s.canteen })}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${s.canteen ? 'bg-green-100 text-green-700 ring-2 ring-green-200' : 'bg-slate-100 text-slate-400 hover:bg-green-50'}`}>
                          {s.canteen ? '🍽️ Inscrit' : '+ Inscrire'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-5 border-t border-slate-100 flex gap-3">
                <button onClick={() => setServiceModal(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  Annuler
                </button>
                <button onClick={async () => { await saveFamilyServices(serviceModal.familyName); setServiceModal(null) }}
                  className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00B8E6] transition-colors">
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
