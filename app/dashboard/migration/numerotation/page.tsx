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
  schoolReduction: number | null
  busReduction: number | null
  canteenReduction: number | null
  phone?: string | null; phoneManuel?: string | null
}

interface StudentLocal extends MigrationStudent {
  _search: string
  _suggestions: PhoneContact[]
  _showSug: boolean
  _phoneSource: 'search' | 'manual' | null
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
  schoolReduction: number | null
  busReduction: number | null
  canteenReduction: number | null
  saving: boolean
}

interface Fees {
  school: number | null
  grandBus: number | null
  petitBus: number | null
  canteen: number | null
}

type ServiceModal = {
  familyName: string
  service: 'school' | 'bus' | 'canteen'
} | null

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
    .slice(0, 6)
}

function formatPhone(p: string | null | undefined) {
  if (!p) return null
  const clean = p.replace(/\s+/g, '').trim()
  if (clean.startsWith('+')) return clean
  if (clean.startsWith('00')) return '+' + clean.slice(2)
  return '+242' + clean
}

function isLocked(status: string) {
  // Only 'pending' means not yet processed — all other statuses (present/absent/gone/new) are final
  return status === 'pending'
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'En cours', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
    present: { label: 'Présent', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
    absent:  { label: 'Absent',  cls: 'bg-red-50 text-red-500 border-red-200' },
    gone:    { label: 'Non identifié', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    new:     { label: 'Nouveau', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500 border-slate-200' }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>
  )
}

// ── PhoneSection must live OUTSIDE the parent component ──────────────────────
// Defining it inside causes React to recreate the component type on every render,
// which unmounts/remounts it and loses input focus.
interface PhoneSectionProps {
  phoneSearch: string
  phoneSource: 'search' | 'manual' | null
  phone: string | null
  phoneManuel: string | null
  showSuggestions: boolean
  suggestions: PhoneContact[]
  locked: boolean
  onSearchChange: (v: string) => void
  onSelectSuggestion: (c: PhoneContact) => void
  onClearSearch: () => void
  onManualChange: (v: string) => void
  onFocus: () => void
  onBlur: () => void
}

function PhoneSection({
  phoneSearch, phoneSource, phone, phoneManuel,
  showSuggestions, suggestions, locked,
  onSearchChange, onSelectSuggestion, onClearSearch, onManualChange, onFocus, onBlur,
}: PhoneSectionProps) {
  const effectivePhone = phoneSource === 'search' ? phone : phoneManuel
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Téléphone</p>
      <div className="relative mb-2">
        <input
          value={phoneSearch}
          onChange={e => onSearchChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={locked}
          placeholder="Chercher par nom dans la liste école…"
          className={`w-full px-3 py-2 rounded-xl border text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF] transition-colors ${
            locked ? 'border-slate-100 bg-slate-50 cursor-not-allowed text-slate-400' : 'border-slate-200'
          }`}
        />
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
          {!locked && (
            <button onClick={onClearSearch} title="Effacer la sélection"
              className="text-slate-400 hover:text-red-500 transition-colors text-sm leading-none">✕</button>
          )}
        </div>
      )}
      <input
        value={phoneManuel ?? ''}
        onChange={e => onManualChange(e.target.value)}
        disabled={locked || phoneSource === 'search'}
        placeholder={
          locked ? 'Ligne verrouillée' :
          phoneSource === 'search' ? 'Effacer ✕ pour saisir manuellement' :
          'Saisir manuellement…'
        }
        className={`w-full px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
          locked || phoneSource === 'search'
            ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
            : 'border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]'
        }`}
      />
      {effectivePhone && !locked && (
        <p className="text-xs text-emerald-600 mt-1 font-mono">✓ {formatPhone(effectivePhone)}</p>
      )}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

// ── ReductionInput must live OUTSIDE the parent component ────────────────────
// Defined inside = new component type on every render = field loses focus on keystroke
interface ReductionInputProps {
  value: number | null
  onChange: (v: number | null) => void
  max: number | null
  disabled?: boolean
}

function ReductionInput({ value, onChange, max, disabled }: ReductionInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.value) { onChange(null); return }
    const n = Number(e.target.value)
    if (max !== null && n > max) { onChange(max); return }
    if (n < 0) { onChange(0); return }
    onChange(n)
  }
  const exceedsMax = max !== null && value !== null && value > max

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="number" min="0" max={max ?? undefined}
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder="0"
          className={`w-24 px-2 py-1.5 rounded-lg border text-sm font-mono transition-colors ${
            disabled
              ? 'border-slate-100 bg-slate-50 cursor-not-allowed text-slate-300'
              : exceedsMax
              ? 'border-red-300 text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300'
              : 'border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00D1FF]'
          }`}
        />
        <span className="text-xs text-slate-500">FCFA</span>
      </div>
      {max !== null && !disabled && (
        <p className={`text-xs ${exceedsMax ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
          {exceedsMax ? `⚠️ Dépasse le max (${max.toLocaleString()} FCFA)` : `max ${max.toLocaleString()} FCFA`}
        </p>
      )}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

export default function NumerotationPage() {
  useAuth()
  const [tab, setTab] = useState<'familles' | 'eleves'>('familles')
  const [familyRows, setFamilyRows] = useState<Record<string, FamilyRow>>({})
  const [studentRows, setStudentRows] = useState<StudentLocal[]>([])
  const [fees, setFees] = useState<Fees>({ school: null, grandBus: null, petitBus: null, canteen: null })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [serviceModal, setServiceModal] = useState<ServiceModal>(null)
  const [modalSelectedIds, setModalSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const sessionsSnap = await getDocs(collection(db, 'migrationSessions'))

    // Load fees from first session
    if (sessionsSnap.docs.length > 0) {
      const fd = sessionsSnap.docs[0].data()
      setFees({
        school: fd.scolariteFee ?? null,
        grandBus: fd.grandBusFee ?? null,
        petitBus: fd.petitBusFee ?? null,
        canteen: fd.canteenFee ?? null,
      })
    }

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
          schoolReduction: data.schoolReduction ?? null,
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
          schoolReduction: null, busReduction: null, canteenReduction: null,
          saving: false,
        }
      }
      fRows[s.family].students.push(s)
      if (!fRows[s.family].phone && s.phone) fRows[s.family].phone = s.phone
      if (!fRows[s.family].phoneManuel && s.phoneManuel) fRows[s.family].phoneManuel = s.phoneManuel
      if (s.schoolReduction !== null && fRows[s.family].schoolReduction === null) fRows[s.family].schoolReduction = s.schoolReduction
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
      })
    ))
    updateFamily(name, { saving: false })
  }

  function openServiceModal(familyName: string, service: 'school' | 'bus' | 'canteen') {
    const row = familyRows[familyName]
    if (!row) return
    let defaultIds: Set<string>
    if (service === 'school') {
      defaultIds = new Set(row.students.filter(s => !isLocked(s.status)).map(s => s.id))
    } else if (service === 'bus') {
      const enrolled = row.students.filter(s => (s.grandBus || s.petitBus) && !isLocked(s.status))
      defaultIds = new Set(enrolled.length > 0 ? enrolled.map(s => s.id) : row.students.filter(s => !isLocked(s.status)).map(s => s.id))
    } else {
      const enrolled = row.students.filter(s => s.canteen && !isLocked(s.status))
      defaultIds = new Set(enrolled.length > 0 ? enrolled.map(s => s.id) : row.students.filter(s => !isLocked(s.status)).map(s => s.id))
    }
    setModalSelectedIds(defaultIds)
    setServiceModal({ familyName, service })
  }

  async function confirmModal() {
    if (!serviceModal) return
    const { familyName, service } = serviceModal
    const row = familyRows[familyName]
    if (!row) return

    const patches = row.students.map(s => {
      const selected = modalSelectedIds.has(s.id)
      if (service === 'school') {
        return updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
          schoolReduction: selected ? (row.schoolReduction ?? null) : null,
        })
      } else if (service === 'bus') {
        return updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
          grandBus: s.grandBus, petitBus: s.petitBus,
          busReduction: (s.grandBus || s.petitBus) && selected ? (row.busReduction ?? null) : null,
        })
      } else {
        return updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
          canteen: s.canteen,
          canteenReduction: s.canteen && selected ? (row.canteenReduction ?? null) : null,
        })
      }
    })
    await Promise.all(patches)
    setServiceModal(null)
  }

  // ── Student helpers ─────────────────────────────────────────────────

  function patchStudent(sid: string, ssid: string, patch: Partial<StudentLocal>) {
    setStudentRows(prev => prev.map(s =>
      s.id === sid && s.sessionId === ssid ? { ...s, ...patch } : s
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
        ? { ...s, phone: c.phone, phoneManuel: null, _search: c.name, _showSug: false, _phoneSource: 'search' }
        : s
    ))
  }

  function clearStudentSearch(sid: string, ssid: string) {
    setStudentRows(prev => prev.map(s =>
      s.id === sid && s.sessionId === ssid ? { ...s, phone: null, _search: '', _phoneSource: null } : s
    ))
  }

  async function saveStudent(s: StudentLocal) {
    patchStudent(s.id, s.sessionId, { _saving: true } as any)
    await updateDoc(doc(db, 'migrationSessions', s.sessionId, 'students', s.id), {
      phone: s._phoneSource === 'search' ? (s.phone ?? null) : null,
      phoneManuel: s._phoneSource === 'manual' ? (s.phoneManuel ?? null) : null,
      grandBus: s.grandBus, petitBus: s.petitBus, canteen: s.canteen,
      schoolReduction: s.schoolReduction ?? null,
      busReduction: s.busReduction ?? null,
      canteenReduction: s.canteenReduction ?? null,
    })
    patchStudent(s.id, s.sessionId, { _saving: false } as any)
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



  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/dashboard/migration" className="hover:text-[#00D1FF]">Migration</Link>
        <span>/</span>
        <span className="text-slate-900 font-semibold">Numéros &amp; Frais</span>
      </div>

      {/* Fee reference */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {fees.school
          ? <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full font-medium">🏫 Scolarité : {fees.school.toLocaleString()} FCFA</span>
          : <span className="text-xs bg-red-50 text-red-400 px-3 py-1.5 rounded-full">🏫 Scolarité non définie</span>}
        {fees.grandBus
          ? <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full font-medium">🚌 Grand Bus : {fees.grandBus.toLocaleString()} FCFA</span>
          : <span className="text-xs bg-red-50 text-red-400 px-3 py-1.5 rounded-full">🚌 Grand Bus non défini</span>}
        {fees.petitBus
          ? <span className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-medium">🚐 Petit Bus : {fees.petitBus.toLocaleString()} FCFA</span>
          : <span className="text-xs bg-red-50 text-red-400 px-3 py-1.5 rounded-full">🚐 Petit Bus non défini</span>}
        {fees.canteen
          ? <span className="text-xs bg-green-50 text-green-600 px-3 py-1.5 rounded-full font-medium">🍽️ Cantine : {fees.canteen.toLocaleString()} FCFA</span>
          : <span className="text-xs bg-red-50 text-red-400 px-3 py-1.5 rounded-full">🍽️ Cantine non définie</span>}
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
            const familyLocked = row.students.some(s => isLocked(s.status))
            const statusCounts = {
              present: row.students.filter(s => s.status === 'present').length,
              absent: row.students.filter(s => s.status === 'absent').length,
              pending: row.students.filter(s => s.status === 'pending').length,
              gone: row.students.filter(s => s.status === 'gone').length,
              new: row.students.filter(s => s.status === 'new').length,
            }

            return (
              <div key={family.name} className={`bg-white rounded-2xl border shadow-sm p-5 transition-opacity ${familyLocked ? 'border-slate-100 opacity-60' : 'border-slate-100'}`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-slate-900 text-base">{family.name}</p>
                      {familyLocked && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200 font-medium">🔒 Non manipulable</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-xs text-slate-400">{row.students.length} élève{row.students.length > 1 ? 's' : ''}</span>
                      {statusCounts.present > 0 && <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full">✅ {statusCounts.present}</span>}
                      {statusCounts.absent > 0 && <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full">⚠️ {statusCounts.absent}</span>}
                      {statusCounts.pending > 0 && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">⏳ {statusCounts.pending}</span>}
                      {statusCounts.gone > 0 && <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">❓ {statusCounts.gone}</span>}
                      {statusCounts.new > 0 && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">✨ {statusCounts.new}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {gbCount > 0 && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">🚌 GB : {gbCount}</span>}
                      {pbCount > 0 && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">🚐 PB : {pbCount}</span>}
                      {ctCount > 0 && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">🍽️ CT : {ctCount}</span>}
                    </div>
                  </div>
                  <button onClick={() => saveFamily(family.name)} disabled={row.saving || familyLocked}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
                      row.saving || familyLocked ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#00D1FF] text-white hover:bg-[#00B8E6]'
                    }`}>
                    {row.saving ? '…' : 'Sauver tél.'}
                  </button>
                </div>

                <div className={`grid grid-cols-4 gap-5 ${familyLocked ? 'pointer-events-none' : ''}`}>
                  {/* Téléphone */}
                  <PhoneSection
                    phoneSearch={row.phoneSearch}
                    phoneSource={row.phoneSource}
                    phone={row.phone}
                    phoneManuel={row.phoneManuel}
                    showSuggestions={row.showSuggestions}
                    suggestions={row.suggestions}
                    locked={familyLocked}
                    onSearchChange={v => onFamilySearchChange(family.name, v)}
                    onSelectSuggestion={c => selectFamilySuggestion(family.name, c)}
                    onClearSearch={() => clearFamilySearch(family.name)}
                    onManualChange={v => updateFamily(family.name, { phoneManuel: v, phoneSource: 'manual' })}
                    onFocus={() => updateFamily(family.name, { showSuggestions: true })}
                    onBlur={() => setTimeout(() => updateFamily(family.name, { showSuggestions: false }), 150)}
                  />

                  {/* Scolarité */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Réd. Scolarité</p>
                    <ReductionInput value={row.schoolReduction} onChange={v => updateFamily(family.name, { schoolReduction: v })} max={fees.school} disabled={familyLocked} />
                    {!familyLocked && (
                      <button onClick={() => openServiceModal(family.name, 'school')}
                        className="mt-2 text-xs text-[#00D1FF] hover:underline font-medium">
                        ✏️ Choisir les élèves
                      </button>
                    )}
                  </div>

                  {/* Bus */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Réd. Bus</p>
                    {!fees.grandBus && !fees.petitBus ? (
                      <p className="text-xs text-red-400 italic">⚠️ Frais bus non définis — configurez-les dans le dashboard</p>
                    ) : hasBus ? (
                      <>
                        <ReductionInput value={row.busReduction} onChange={v => updateFamily(family.name, { busReduction: v })} max={fees.grandBus ?? fees.petitBus} disabled={familyLocked} />
                        {!familyLocked && (
                          <button onClick={() => openServiceModal(family.name, 'bus')}
                            className="mt-2 text-xs text-[#00D1FF] hover:underline font-medium block">
                            ✏️ Gérer bus + réd. ({gbCount + pbCount})
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400 italic">Aucun inscrit au bus</p>
                        {!familyLocked && (
                          <button onClick={() => openServiceModal(family.name, 'bus')}
                            className="text-xs text-slate-500 hover:text-[#00D1FF] transition-colors">
                            + Inscrire des élèves
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cantine */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Réd. Cantine</p>
                    {!fees.canteen ? (
                      <p className="text-xs text-red-400 italic">⚠️ Frais cantine non définis — configurez-les dans le dashboard</p>
                    ) : hasCanteen ? (
                      <>
                        <ReductionInput value={row.canteenReduction} onChange={v => updateFamily(family.name, { canteenReduction: v })} max={fees.canteen} disabled={familyLocked} />
                        {!familyLocked && (
                          <button onClick={() => openServiceModal(family.name, 'canteen')}
                            className="mt-2 text-xs text-[#00D1FF] hover:underline font-medium block">
                            ✏️ Gérer cantine + réd. ({ctCount})
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400 italic">Aucun inscrit à la cantine</p>
                        {!familyLocked && (
                          <button onClick={() => openServiceModal(family.name, 'canteen')}
                            className="text-xs text-slate-500 hover:text-[#00D1FF] transition-colors">
                            + Inscrire des élèves
                          </button>
                        )}
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
            const locked = isLocked(s.status)
            const hasBus = s.grandBus || s.petitBus
            const busFeeMax = s.grandBus ? fees.grandBus : s.petitBus ? fees.petitBus : null

            return (
              <div key={`${s.sessionId}-${s.id}`} className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-opacity ${locked ? 'opacity-60' : ''}`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                      {s.firstName[0]}{s.lastName[0]}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{s.firstName} {s.lastName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-slate-400">{s.className}</p>
                        <StatusBadge status={s.status} />
                        {locked && <span className="text-xs text-slate-400">🔒</span>}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => saveStudent(s)} disabled={s._saving || locked}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
                      s._saving || locked ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#00D1FF] text-white hover:bg-[#00B8E6]'
                    }`}>
                    {s._saving ? '…' : 'Sauver'}
                  </button>
                </div>

                <div className={`grid grid-cols-4 gap-5 ${locked ? 'pointer-events-none' : ''}`}>
                  {/* Téléphone */}
                  <PhoneSection
                    phoneSearch={s._search}
                    phoneSource={s._phoneSource}
                    phone={s.phone ?? null}
                    phoneManuel={s.phoneManuel ?? null}
                    showSuggestions={s._showSug}
                    suggestions={s._suggestions}
                    locked={locked}
                    onSearchChange={v => onStudentSearchChange(s.id, s.sessionId, v)}
                    onSelectSuggestion={c => selectStudentSuggestion(s.id, s.sessionId, c)}
                    onClearSearch={() => clearStudentSearch(s.id, s.sessionId)}
                    onManualChange={v => patchStudent(s.id, s.sessionId, { phoneManuel: v, _phoneSource: 'manual' } as any)}
                    onFocus={() => patchStudent(s.id, s.sessionId, { _showSug: true } as any)}
                    onBlur={() => setTimeout(() => patchStudent(s.id, s.sessionId, { _showSug: false } as any), 150)}
                  />

                  {/* Scolarité */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Réd. Scolarité</p>
                    <ReductionInput
                      value={s.schoolReduction}
                      onChange={v => patchStudent(s.id, s.sessionId, { schoolReduction: v })}
                      max={fees.school}
                      disabled={locked}
                    />
                  </div>

                  {/* Bus */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Bus</p>
                    {!fees.grandBus && !fees.petitBus ? (
                      <p className="text-xs text-red-400 italic">⚠️ Frais bus non définis</p>
                    ) : hasBus ? (
                      <div className="space-y-2">
                        <div className="flex gap-1.5 flex-wrap">
                          <button
                            onClick={() => patchStudent(s.id, s.sessionId, s.grandBus ? { grandBus: false } : { grandBus: true, petitBus: false })}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${s.grandBus ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200' : fees.grandBus ? 'bg-slate-100 text-slate-500 hover:bg-blue-50' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}
                            disabled={!fees.grandBus}>
                            🚌 GB
                          </button>
                          <button
                            onClick={() => patchStudent(s.id, s.sessionId, s.petitBus ? { petitBus: false } : { petitBus: true, grandBus: false })}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${s.petitBus ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200' : fees.petitBus ? 'bg-slate-100 text-slate-500 hover:bg-indigo-50' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}
                            disabled={!fees.petitBus}>
                            🚐 PB
                          </button>
                        </div>
                        <ReductionInput value={s.busReduction} onChange={v => patchStudent(s.id, s.sessionId, { busReduction: v })} max={busFeeMax} disabled={locked} />
                        <button onClick={() => patchStudent(s.id, s.sessionId, { grandBus: false, petitBus: false, busReduction: null })}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">
                          ✕ Désinscrire
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 italic">Non inscrit au bus</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {fees.grandBus && (
                            <button onClick={() => patchStudent(s.id, s.sessionId, { grandBus: true, petitBus: false })}
                              className="px-2 py-1 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 transition-colors">
                              + 🚌 GB
                            </button>
                          )}
                          {fees.petitBus && (
                            <button onClick={() => patchStudent(s.id, s.sessionId, { petitBus: true, grandBus: false })}
                              className="px-2 py-1 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors">
                              + 🚐 PB
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cantine */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cantine</p>
                    {!fees.canteen ? (
                      <p className="text-xs text-red-400 italic">⚠️ Frais cantine non définis</p>
                    ) : s.canteen ? (
                      <div className="space-y-2">
                        <span className="inline-block px-2 py-1 rounded-lg text-xs bg-green-100 text-green-700 font-medium ring-2 ring-green-200">🍽️ Inscrit</span>
                        <ReductionInput value={s.canteenReduction} onChange={v => patchStudent(s.id, s.sessionId, { canteenReduction: v })} max={fees.canteen} disabled={locked} />
                        <button onClick={() => patchStudent(s.id, s.sessionId, { canteen: false, canteenReduction: null })}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">
                          ✕ Désinscrire
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 italic">Non inscrit à la cantine</p>
                        <button onClick={() => patchStudent(s.id, s.sessionId, { canteen: true })}
                          className="px-2 py-1 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-700 transition-colors">
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

      {/* ── MODAL SERVICES FAMILLE ── */}
      {serviceModal && (() => {
        const row = familyRows[serviceModal.familyName]
        if (!row) return null
        const { service } = serviceModal
        const labels = { school: '🏫 Scolarité', bus: '🚌 Bus', canteen: '🍽️ Cantine' }
        const reductionVal = service === 'school' ? row.schoolReduction : service === 'bus' ? row.busReduction : row.canteenReduction

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setServiceModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-100">
                <h3 className="font-bold text-slate-900 text-lg">{labels[service]} — Réduction</h3>
                <p className="text-sm text-slate-500 mt-0.5">{serviceModal.familyName}</p>
                {reductionVal !== null && reductionVal !== undefined
                  ? <p className="text-xs text-[#00D1FF] mt-1 font-medium">Réduction : {reductionVal.toLocaleString()} FCFA</p>
                  : <p className="text-xs text-amber-500 mt-1">⚠️ Aucune réduction saisie — sauver d'abord</p>
                }
                <p className="text-xs text-slate-400 mt-2">Cochez les élèves qui bénéficient de cette réduction (tous sélectionnés par défaut)</p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                {/* Select all toggle */}
                <button
                  onClick={() => {
                    const unlocked = row.students.filter(s => !isLocked(s.status))
                    if (modalSelectedIds.size === unlocked.length) setModalSelectedIds(new Set())
                    else setModalSelectedIds(new Set(unlocked.map(s => s.id)))
                  }}
                  className="w-full text-left text-xs text-slate-500 hover:text-[#00D1FF] transition-colors py-1 border-b border-slate-50 mb-1">
                  {modalSelectedIds.size === row.students.filter(s => !isLocked(s.status)).length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>

                {row.students.map(s => {
                  const studentLocked = isLocked(s.status)
                  const checked = modalSelectedIds.has(s.id)
                  const enrolled = service === 'bus' ? (s.grandBus || s.petitBus) : service === 'canteen' ? s.canteen : true

                  return (
                    <div key={s.id} className={`flex items-center justify-between py-2 px-1 rounded-xl transition-colors ${studentLocked ? 'opacity-50' : checked ? 'bg-[#00D1FF]/5' : ''}`}>
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${s.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}`}>
                          {s.firstName[0]}{s.lastName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{s.firstName} {s.lastName}</p>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-slate-400">{s.className}</p>
                            <StatusBadge status={s.status} />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Bus enrollment toggles (only in bus modal) */}
                        {service === 'bus' && !studentLocked && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => updateFamilyStudent(serviceModal.familyName, s.id, s.sessionId,
                                s.grandBus ? { grandBus: false } : { grandBus: true, petitBus: false }
                              )}
                              className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${s.grandBus ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                              🚌
                            </button>
                            <button
                              onClick={() => updateFamilyStudent(serviceModal.familyName, s.id, s.sessionId,
                                s.petitBus ? { petitBus: false } : { petitBus: true, grandBus: false }
                              )}
                              className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${s.petitBus ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
                              🚐
                            </button>
                          </div>
                        )}
                        {/* Canteen enrollment toggle */}
                        {service === 'canteen' && !studentLocked && (
                          <button
                            onClick={() => updateFamilyStudent(serviceModal.familyName, s.id, s.sessionId, { canteen: !s.canteen })}
                            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${s.canteen ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                            🍽️
                          </button>
                        )}
                        {/* Reduction checkbox */}
                        {!studentLocked && (service === 'school' || enrolled) && (
                          <button
                            onClick={() => {
                              const next = new Set(modalSelectedIds)
                              if (next.has(s.id)) next.delete(s.id)
                              else next.add(s.id)
                              setModalSelectedIds(next)
                            }}
                            className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${
                              checked ? 'bg-[#00D1FF] border-[#00D1FF] text-white' : 'border-slate-300'
                            }`}>
                            {checked && <span className="text-xs leading-none">✓</span>}
                          </button>
                        )}
                        {studentLocked && <span className="text-xs text-slate-400">🔒</span>}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="p-5 border-t border-slate-100 flex gap-3">
                <button onClick={() => setServiceModal(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  Annuler
                </button>
                <button onClick={confirmModal}
                  className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00B8E6] transition-colors">
                  Confirmer & Sauver
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
