'use client'

import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import PhoneInput from '../../../_components/PhoneInput'

interface Props {
  schoolYearId: string
  uid: string
  onClose: () => void
}

export default function AddFamilyModal({ schoolYearId, uid, onClose }: Props) {
  const [familyName, setFamilyName] = useState('')
  const [contacts, setContacts] = useState([{ name: '', phone: '', dialCode: '+242', relation: '' }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function addContact() {
    setContacts([...contacts, { name: '', phone: '', dialCode: '+242', relation: '' }])
  }

  function removeContact(i: number) {
    if (contacts.length === 1) return
    setContacts(contacts.filter((_, idx) => idx !== i))
  }

  function updateContact(i: number, field: string, value: string) {
    setContacts(contacts.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!familyName.trim()) { setError('Le nom de la famille est requis.'); return }
    setSaving(true)
    onClose() // ← ferme immédiatement
    try {
      await addDoc(collection(db, 'families'), {
        name: familyName.trim(),
        contacts: contacts.filter((c) => c.name.trim()),
        schoolYearId,
        userId: uid,
      })
    } catch {
      setError('Erreur lors de la création. Vérifiez votre connexion.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-slate-900">Ajouter une famille</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Nom de la famille *</label>
            <input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="Ex: Famille Alaoui"
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Contacts / Titulaires</label>
              <button type="button" onClick={addContact} className="text-xs text-[#00D1FF] font-medium hover:underline">
                + Ajouter
              </button>
            </div>
            <div className="space-y-3">
              {contacts.map((c, i) => (
                <div key={i} className="space-y-1.5 p-3 bg-slate-50 rounded-xl">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={c.name}
                      onChange={(e) => updateContact(i, 'name', e.target.value)}
                      placeholder="Nom du contact"
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    />
                    <input
                      value={c.relation}
                      onChange={(e) => updateContact(i, 'relation', e.target.value)}
                      placeholder="Relation (Père, Mère…)"
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                    />
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
                      <button type="button" onClick={() => removeContact(i)} className="text-slate-300 hover:text-red-400 px-1 text-lg leading-none">✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold shadow-sm hover:bg-[#00b8e0] disabled:opacity-60"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Création…
                </span>
              ) : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}