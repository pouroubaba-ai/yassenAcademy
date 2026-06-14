'use client'

import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { useCurrency, CURRENCIES } from '../../_lib/currency-context'

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

interface Secretary {
  id: string
  name: string
  email: string
  code: string
  isActive: boolean
}

export default function ParametresPage() {
  const { allYears, activeYear, uid } = useSchoolYear()
  const { symbol } = useCurrency()
  const [settings, setSettings] = useState({ name: '', address: '', phone: '', email: '', website: '', currency: 'MAD', wasenderApiKey: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [editingFee, setEditingFee] = useState(false)
  const [newFee, setNewFee] = useState('')
  const [feeError, setFeeError] = useState('')
  const [savingFee, setSavingFee] = useState(false)

  // Secretaries
  const [secretaries, setSecretaries] = useState<Secretary[]>([])
  const [showAddSec, setShowAddSec] = useState(false)
  const [secForm, setSecForm] = useState({ name: '', email: '', code: '' })
  const [secError, setSecError] = useState('')
  const [savingSec, setSavingSec] = useState(false)
  const [editingSecId, setEditingSecId] = useState<string | null>(null)
  const [editCode, setEditCode] = useState('')

  useEffect(() => {
    if (!uid) return
    getDoc(doc(db, 'settings', uid)).then((snap) => {
      if (snap.exists()) setSettings({ currency: 'MAD', wasenderApiKey: '', ...snap.data() } as typeof settings)
    })
  }, [uid])

  useEffect(() => {
    if (!uid) return
    getDocs(query(collection(db, 'secretaries'), where('ownerId', '==', uid))).then((snap) => {
      setSecretaries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Secretary)))
    })
  }, [uid])

  async function handleAddSecretary() {
    if (!uid) return
    if (!secForm.name.trim() || !secForm.email.trim() || !secForm.code.trim()) {
      setSecError('Tous les champs sont requis.')
      return
    }
    setSavingSec(true)
    setSecError('')
    try {
      const ref = await addDoc(collection(db, 'secretaries'), {
        name: secForm.name.trim(),
        email: secForm.email.trim().toLowerCase(),
        code: secForm.code.trim(),
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
      })
      setSecretaries((prev) => [...prev, { id: ref.id, name: secForm.name.trim(), email: secForm.email.trim().toLowerCase(), code: secForm.code.trim(), isActive: true }])
      setSecForm({ name: '', email: '', code: '' })
      setShowAddSec(false)
    } catch {
      setSecError('Erreur lors de la création.')
    } finally {
      setSavingSec(false)
    }
  }

  async function toggleSecretary(sec: Secretary) {
    await updateDoc(doc(db, 'secretaries', sec.id), { isActive: !sec.isActive })
    setSecretaries((prev) => prev.map((s) => s.id === sec.id ? { ...s, isActive: !s.isActive } : s))
  }

  async function deleteSecretary(id: string) {
    if (!window.confirm('Supprimer ce compte secrétaire ?')) return
    await deleteDoc(doc(db, 'secretaries', id))
    setSecretaries((prev) => prev.filter((s) => s.id !== id))
  }

  async function saveEditCode(sec: Secretary) {
    if (!editCode.trim()) return
    await updateDoc(doc(db, 'secretaries', sec.id), { code: editCode.trim() })
    setSecretaries((prev) => prev.map((s) => s.id === sec.id ? { ...s, code: editCode.trim() } : s))
    setEditingSecId(null)
    setEditCode('')
  }

  async function handleSave(e: React.FormEvent) {
    if (!uid) return
    e.preventDefault()
    setSaving(true)
    setDoc(doc(db, 'settings', uid), settings) // sans await
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleSaveFee() {
    const val = parseFloat(newFee)
    if (!val || val <= 0) { setFeeError('Le montant doit être supérieur à zéro.'); return }
    if (!activeYear || !uid) return
    setSavingFee(true)
    setFeeError('')
    setEditingFee(false)
    setNewFee('')
    try {
      // 1. Update school year monthlyFee
      await updateDoc(doc(db, 'schoolYears', activeYear.id), { monthlyFee: val })

      // 2. Update the default fee in the fees collection (with userId for security rules)
      const feesSnap = await getDocs(
        query(collection(db, 'fees'),
          where('schoolYearId', '==', activeYear.id),
          where('userId', '==', uid),
          where('isDefault', '==', true))
      )
      await Promise.all(feesSnap.docs.map((d) => updateDoc(doc(db, 'fees', d.id), { monthlyAmount: val })))

      // 3. Update future monthly entries that contain the default fee
      const now = new Date()
      const nowMonth = now.getMonth() + 1
      const nowYear = now.getFullYear()

      const defaultFeeIds = new Set(feesSnap.docs.map((d) => d.id))
      if (defaultFeeIds.size > 0) {
        const entriesSnap = await getDocs(
          query(collection(db, 'monthlyEntries'),
            where('schoolYearId', '==', activeYear.id),
            where('userId', '==', uid))
        )
        const entryUpdates: Promise<void>[] = []
        for (const d of entriesSnap.docs) {
          const entry = d.data()
          const isFuture = entry.year > nowYear || (entry.year === nowYear && entry.month > nowMonth)
          if (!isFuture) continue

          const fees: any[] = entry.fees ?? []
          let changed = false
          const updatedFees = fees.map((ef: any) => {
            if (!defaultFeeIds.has(ef.feeId)) return ef
            changed = true
            const newDue = Math.max(0, val - (ef.reduction ?? 0))
            const newBalance = Math.max(0, newDue - (ef.paid ?? 0))
            return { ...ef, amount: val, due: newDue, balance: newBalance }
          })
          if (!changed) continue
          const totalDue = updatedFees.reduce((s: number, f: any) => s + f.due, 0)
          const totalBalance = updatedFees.reduce((s: number, f: any) => s + f.balance, 0)
          entryUpdates.push(updateDoc(doc(db, 'monthlyEntries', d.id), { fees: updatedFees, totalDue, totalBalance }))
        }
        await Promise.all(entryUpdates)
      }
    } catch {
      setFeeError('Erreur lors de la mise à jour.')
    } finally {
      setSavingFee(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
        <p className="text-slate-500 text-sm mt-1">Informations de votre établissement</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <h2 className="text-base font-bold text-slate-900 mb-5">Informations de l'école</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Nom de l'établissement</label>
              <input
                value={settings.name}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                placeholder="Yassen Academy"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Téléphone</label>
              <input
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                placeholder="+212 6XX XXX XXX"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Adresse</label>
              <input
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                placeholder="123 Rue de l'École, Casablanca"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                placeholder="contact@ecole.com"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Site web</label>
              <input
                value={settings.website}
                onChange={(e) => setSettings({ ...settings, website: e.target.value })}
                placeholder="www.ecole.com"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Clé API WaSenderAPI</label>
              <input
                value={settings.wasenderApiKey}
                onChange={(e) => setSettings({ ...settings, wasenderApiKey: e.target.value })}
                placeholder="Colle ta clé API WaSenderAPI ici"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] font-mono"
              />
              <p className="text-xs text-slate-400 mt-1">Clé API de ton compte WaSenderAPI — permet l'envoi des avis par WhatsApp.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Devise</label>
              <select
                value={settings.currency}
                onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              >
                {Object.entries(CURRENCIES).map(([code, { label }]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-[#00D1FF] text-white px-6 py-2.5 rounded-xl font-semibold text-sm shadow-sm hover:bg-[#00b8e0] transition-colors disabled:opacity-60"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {saved && <span className="text-sm text-emerald-600 font-medium">✓ Modifications sauvegardées</span>}
          </div>
        </form>
      </div>

      {/* Secretary management */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Comptes secrétaires</h2>
            <p className="text-xs text-slate-500 mt-0.5">Les secrétaires accèdent uniquement à la section pédagogie.</p>
          </div>
          <button
            onClick={() => { setShowAddSec(true); setSecError('') }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Ajouter
          </button>
        </div>

        {showAddSec && (
          <div className="mb-5 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <p className="text-sm font-semibold text-slate-800">Nouveau secrétaire</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nom</label>
                <input value={secForm.name} onChange={(e) => setSecForm({ ...secForm, name: e.target.value })}
                  placeholder="Prénom Nom"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={secForm.email} onChange={(e) => setSecForm({ ...secForm, email: e.target.value })}
                  placeholder="secretaire@ecole.com"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code d'accès</label>
                <input value={secForm.code} onChange={(e) => setSecForm({ ...secForm, code: e.target.value })}
                  placeholder="ex: 1234"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
              </div>
            </div>
            {secError && <p className="text-xs text-red-500">{secError}</p>}
            <div className="flex gap-2">
              <button onClick={handleAddSecretary} disabled={savingSec}
                className="px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] transition-colors disabled:opacity-60">
                {savingSec ? '…' : 'Créer'}
              </button>
              <button onClick={() => { setShowAddSec(false); setSecError('') }}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-white transition-colors">
                Annuler
              </button>
            </div>
          </div>
        )}

        {secretaries.length === 0 ? (
          <p className="text-slate-500 text-sm">Aucun compte secrétaire créé.</p>
        ) : (
          <div className="space-y-3">
            {secretaries.map((sec) => (
              <div key={sec.id} className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">{sec.name}</p>
                  <p className="text-xs text-slate-500 truncate">{sec.email}</p>
                  {editingSecId === sec.id ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <input value={editCode} onChange={(e) => setEditCode(e.target.value)}
                        placeholder="Nouveau code"
                        className="w-28 px-2 py-1 rounded-lg border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#00D1FF]" />
                      <button onClick={() => saveEditCode(sec)}
                        className="px-3 py-1 rounded-lg bg-[#00D1FF] text-white text-xs font-semibold hover:bg-[#00b8e0]">
                        Valider
                      </button>
                      <button onClick={() => { setEditingSecId(null); setEditCode('') }}
                        className="text-xs text-slate-500 hover:text-slate-700">
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingSecId(sec.id); setEditCode(sec.code) }}
                      className="text-xs text-[#00D1FF] hover:underline mt-0.5">
                      Modifier le code
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleSecretary(sec)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${sec.isActive ? 'bg-emerald-400' : 'bg-slate-200'}`}
                    title={sec.isActive ? 'Désactiver' : 'Activer'}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${sec.isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <button onClick={() => deleteSecretary(sec.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-bold text-slate-900 mb-5">Années scolaires</h2>
        {allYears.length === 0 ? (
          <p className="text-slate-500 text-sm">Aucune année scolaire créée.</p>
        ) : (
          <div className="space-y-3">
            {allYears.map((year) => (
              <div key={year.id} className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">
                      {MONTHS[year.startMonth - 1]} {year.startYear} — {MONTHS[year.endMonth - 1]} {year.endYear}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-slate-500">
                        Scolarité : <span className="font-medium text-slate-700">{year.monthlyFee.toLocaleString('fr-FR')} {symbol}/mois</span>
                      </p>
                      {year.isActive && !editingFee && (
                        <button
                          onClick={() => { setNewFee(String(year.monthlyFee)); setEditingFee(true); setFeeError('') }}
                          className="text-xs text-[#00D1FF] hover:underline"
                        >
                          Modifier
                        </button>
                      )}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${year.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                    {year.isActive && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
                    {year.isActive ? 'En cours' : 'Terminée'}
                  </span>
                </div>

                {year.isActive && editingFee && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={newFee}
                        onChange={(e) => setNewFee(e.target.value)}
                        className="w-36 px-3 py-2 pr-14 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
                        autoFocus
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{symbol}</span>
                    </div>
                    <button
                      onClick={handleSaveFee}
                      disabled={savingFee}
                      className="px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold hover:bg-[#00b8e0] transition-colors disabled:opacity-60"
                    >
                      {savingFee ? '…' : 'Valider'}
                    </button>
                    <button
                      onClick={() => { setEditingFee(false); setFeeError('') }}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-white transition-colors"
                    >
                      Annuler
                    </button>
                    {feeError && <p className="text-xs text-red-500">{feeError}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}