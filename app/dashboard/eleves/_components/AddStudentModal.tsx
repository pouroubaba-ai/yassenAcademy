'use client'

import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { SchoolClass, Family, Fee, Student, Contact } from '../../../_lib/types'
import PhoneInput from '../../../_components/PhoneInput'

interface Props {
  classes: SchoolClass[]
  families: Family[]
  fees: Fee[]
  students: Student[]
  schoolYearId: string
  uid: string
  onClose: () => void
}

export default function AddStudentModal({ classes, families, fees, students, schoolYearId, uid, onClose }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gender, setGender] = useState<'M' | 'F' | ''>('')
  const [classId, setClassId] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [familyId, setFamilyId] = useState('')
  const [familySearch, setFamilySearch] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([{ name: '', phone: '', dialCode: '+242', relation: '' }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const filteredFamilies = families.filter(f =>
    f.name.toLowerCase().includes(familySearch.toLowerCase())
  )

  function updateContact(i: number, field: keyof Contact, value: string) {
    setContacts(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }
  function addContact() {
    setContacts(prev => [...prev, { name: '', phone: '', dialCode: '+242', relation: '' }])
  }
  function removeContact(i: number) {
    setContacts(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!firstName.trim() || !lastName.trim()) { setError('Le prénom et le nom sont requis.'); return }
    if (!classId) { setError('La classe est obligatoire.'); return }
    if (!gender) { setError('Le sexe est obligatoire.'); return }

    const isDuplicate = students.some(
      (s) =>
        s.firstName.trim().toLowerCase() === firstName.trim().toLowerCase() &&
        s.lastName.trim().toLowerCase() === lastName.trim().toLowerCase()
    )
    if (isDuplicate) {
      setError('Un élève avec ce prénom et ce nom existe déjà dans cette année scolaire.')
      return
    }

    setSaving(true)
    const defaultFees = fees.filter((f) => f.isDefault)
    let appliedFees = defaultFees.map((f) => ({ feeId: f.id, reduction: 0 }))

    if (familyId) {
      const siblings = students.filter((s) => s.familyId === familyId && s.isActive)
      if (siblings.length > 0) {
        const optionalFees = fees.filter((f) => !f.isDefault)
        for (const fee of optionalFees) {
          const allHaveIt = siblings.every((s) => s.appliedFees.some((af) => af.feeId === fee.id))
          if (allHaveIt && !appliedFees.some((af) => af.feeId === fee.id)) {
            const siblingReduction = siblings[0].appliedFees.find((af) => af.feeId === fee.id)?.reduction ?? 0
            appliedFees.push({ feeId: fee.id, reduction: siblingReduction })
          }
        }
      }
    }

    const validContacts = contacts.filter(c => c.name.trim() || c.phone.trim())

    onClose()
    try {
      await addDoc(collection(db, 'students'), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender,
        classId,
        birthDate: birthDate || null,
        familyId: familyId || null,
        contacts: validContacts.length > 0 ? validContacts : [],
        isActive: true,
        schoolYearId,
        userId: uid,
        appliedFees,
      })
    } catch {
      setError('Erreur lors de la création. Vérifiez votre connexion.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-slate-900">Ajouter un élève</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Prénom *</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Nom *</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Sexe *</label>
              <div className="flex gap-2">
                {(['M', 'F'] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setGender(g)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${gender === g ? 'border-[#00D1FF] bg-[#00D1FF]/10 text-[#00D1FF]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {g === 'M' ? 'Garçon' : 'Fille'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Date de naissance</label>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Classe *</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]">
              <option value="">— Choisir une classe —</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Famille avec recherche */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Famille (optionnel)</label>
            <input
              value={familySearch}
              onChange={(e) => { setFamilySearch(e.target.value); setFamilyId('') }}
              placeholder="Rechercher une famille…"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] mb-2"
            />
            {familySearch && (
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-36 overflow-y-auto">
                <button type="button" onClick={() => { setFamilyId(''); setFamilySearch('') }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-50">
                  — Aucune famille —
                </button>
                {filteredFamilies.map(f => (
                  <button key={f.id} type="button"
                    onClick={() => { setFamilyId(f.id); setFamilySearch(f.name) }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${familyId === f.id ? 'bg-[#00D1FF]/10 text-[#00D1FF] font-medium' : 'hover:bg-slate-50 text-slate-700'}`}>
                    {f.name}
                  </button>
                ))}
                {filteredFamilies.length === 0 && (
                  <p className="px-3 py-2 text-sm text-slate-400">Aucune famille trouvée</p>
                )}
              </div>
            )}
            {familyId && (
              <p className="text-xs text-[#00D1FF] mt-1">✓ Famille sélectionnée : {families.find(f => f.id === familyId)?.name}</p>
            )}
          </div>

          {/* Contacts / Tuteurs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">Tuteurs / Contacts</label>
              <button type="button" onClick={addContact}
                className="text-xs text-[#00D1FF] hover:underline">+ Ajouter</button>
            </div>
            <div className="space-y-3">
              {contacts.map((c, i) => (
                <div key={i} className="space-y-1.5 p-3 bg-slate-50 rounded-xl">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={c.name} onChange={(e) => updateContact(i, 'name', e.target.value)}
                      placeholder="Nom du tuteur" className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                    <input value={c.relation} onChange={(e) => updateContact(i, 'relation', e.target.value)}
                      placeholder="Lien (Père, Mère…)" className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                  </div>
                  <div className="flex gap-1 items-center">
                    <PhoneInput
                      dialCode={c.dialCode || '+242'}
                      phone={c.phone}
                      onDialCodeChange={(v) => updateContact(i, 'dialCode', v)}
                      onPhoneChange={(v) => updateContact(i, 'phone', v)}
                      className="flex-1"
                    />
                    {contacts.length > 1 && (
                      <button type="button" onClick={() => removeContact(i)}
                        className="text-slate-300 hover:text-red-400 px-1 text-lg leading-none">✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold shadow-sm hover:bg-[#00b8e0] disabled:opacity-60">
              {saving ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Création…</span> : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
