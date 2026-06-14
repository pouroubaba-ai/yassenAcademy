'use client'

import { useState, useEffect } from 'react'
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, getDocs,
} from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { useCurrency } from '../../_lib/currency-context'
import { Fee } from '../../_lib/types'

export default function FraisPage() {
  const { activeYear, uid } = useSchoolYear()
  const { symbol } = useCurrency()
  const [fees, setFees] = useState<Fee[]>([])
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    if (!activeYear || !uid) return
    const q = query(collection(db, 'fees'), where('schoolYearId', '==', activeYear.id), where('userId', '==', uid))
    return onSnapshot(q, (snap) => {
      setFees(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Fee)))
    })
  }, [activeYear, uid])

  async function handleDelete(fee: Fee) {
    if (!confirm(`Supprimer le frais "${fee.name}" ?`)) return
    await deleteDoc(doc(db, 'fees', fee.id))
  }

  if (!activeYear) {
    return <div className="p-8"><p className="text-slate-500 text-sm">Aucune année scolaire active.</p></div>
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Frais</h1>
          <p className="text-slate-500 text-sm mt-1">Gérez les frais applicables aux élèves</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter un frais
          </button>
        )}
      </div>

      <div className="space-y-3">
        {fees
          .sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : 0))
          .map((fee) => (
            <FeeCard
              key={fee.id}
              fee={fee}
              symbol={symbol}
              schoolYearId={activeYear.id}
              uid={uid ?? ''}
              onDelete={() => handleDelete(fee)}
            />
          ))}

        {showAdd && (
          <AddFeeCard
            symbol={symbol}
            schoolYearId={activeYear.id}
            uid={uid ?? ''}
            onDone={() => setShowAdd(false)}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </div>
    </div>
  )
}

function FeeCard({ fee, symbol, schoolYearId, uid, onDelete }: {
  fee: Fee; symbol: string; schoolYearId: string; uid: string; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(fee.name)
  const [amount, setAmount] = useState(String(fee.monthlyAmount))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function openEdit() {
    setName(fee.name)
    setAmount(String(fee.monthlyAmount))
    setError('')
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError('')
  }

  async function save() {
    const val = parseFloat(amount)
    if (!name.trim()) { setError('Le nom est requis.'); return }
    if (!val || val <= 0) { setError('Le montant doit être supérieur à zéro.'); return }
    setSaving(true)
    setError('')
    setEditing(false)
    try {
      // 1. Update the fee definition
      await updateDoc(doc(db, 'fees', fee.id), { name: name.trim(), monthlyAmount: val })

      // 2. If amount changed, update all FUTURE month entries that contain this fee
      //    (entries where totalPaid = 0 and month > now, to avoid touching paid history)
      if (val !== fee.monthlyAmount) {
        const now = new Date()
        const nowMonth = now.getMonth() + 1
        const nowYear = now.getFullYear()

        const snap = await getDocs(
          query(
            collection(db, 'monthlyEntries'),
            where('schoolYearId', '==', schoolYearId),
            where('userId', '==', uid),
          )
        )

        const updates: Promise<void>[] = []
        for (const d of snap.docs) {
          const entry = d.data()
          const isFuture = entry.year > nowYear || (entry.year === nowYear && entry.month > nowMonth)
          if (!isFuture) continue

          const fees: any[] = entry.fees ?? []
          const feeIndex = fees.findIndex((ef: any) => ef.feeId === fee.id)
          if (feeIndex === -1) continue

          // Rebuild this fee with new amount, keeping paid and reduction
          const ef = fees[feeIndex]
          const newDue = Math.max(0, val - (ef.reduction ?? 0))
          const newBalance = Math.max(0, newDue - (ef.paid ?? 0))
          const updatedFees = [...fees]
          updatedFees[feeIndex] = {
            ...ef,
            feeName: name.trim(),
            amount: val,
            due: newDue,
            balance: newBalance,
          }
          const totalDue = updatedFees.reduce((s: number, f: any) => s + f.due, 0)
          const totalBalance = updatedFees.reduce((s: number, f: any) => s + f.balance, 0)
          updates.push(updateDoc(doc(db, 'monthlyEntries', d.id), { fees: updatedFees, totalDue, totalBalance }))
        }
        await Promise.all(updates)
      }
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
        <div className="flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du frais"
            disabled={fee.isDefault}
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] disabled:bg-slate-50 disabled:text-slate-400"
            autoFocus={!fee.isDefault}
          />
          <div className="relative w-36">
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus={fee.isDefault}
              className="w-full px-3 py-2 pr-14 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{symbol}</span>
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button onClick={cancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 transition-colors">
            Annuler
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors disabled:opacity-60"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-900 text-sm">{fee.name}</p>
          {fee.isDefault && (
            <span className="text-xs bg-[#00D1FF]/10 text-[#00D1FF] font-medium px-2 py-0.5 rounded-full">Par défaut</span>
          )}
        </div>
        <p className="text-slate-500 text-sm mt-0.5">
          {fee.monthlyAmount.toLocaleString('fr-FR')} {symbol} / mois
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={openEdit}
          className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        {!fee.isDefault && (
          <button
            onClick={onDelete}
            className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function AddFeeCard({
  symbol, schoolYearId, uid, onDone, onCancel,
}: {
  symbol: string; schoolYearId: string; uid: string; onDone: () => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const val = parseFloat(amount)
    if (!name.trim()) { setError('Le nom est requis.'); return }
    if (!val || val <= 0) { setError('Le montant doit être supérieur à zéro.'); return }
    setSaving(true)
    setError('')
    onDone()
    try {
      await addDoc(collection(db, 'fees'), {
        name: name.trim(),
        monthlyAmount: val,
        isDefault: false,
        schoolYearId,
        userId: uid,
      })
    } catch {
      setError('Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#00D1FF]/30 p-4 space-y-3">
      <div className="flex gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom du frais"
          autoFocus
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
        />
        <div className="relative w-36">
          <input
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 pr-14 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{symbol}</span>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 transition-colors">Annuler</button>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-[#00D1FF] text-white text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors disabled:opacity-60"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}