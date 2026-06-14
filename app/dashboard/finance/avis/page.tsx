'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { collection, query, where, getDocs, getDoc, doc, addDoc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { useCurrency } from '../../../_lib/currency-context'
import { Student, SchoolClass, Family, Fee, MonthlyEntry, WhatsappResult } from '../../../_lib/types'
import { MONTHS_FR, getSchoolYearMonths } from '../../../_lib/finance-utils'
import { buildFullPhone } from '../../../_components/PhoneInput'

/** Format number for jsPDF -- plain ASCII digits only, no locale characters */
function fmtPdf(n: number, symbol: string): string {
  const s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return s + ' ' + symbol
}

type Step = 'select' | 'preview' | 'generate'
type MainTab = 'avis' | 'campagnes'
type PeriodMode = 'month' | 'year'

interface DebtorFamily {
  family: Family
  members: { student: Student; entries: MonthlyEntry[] }[]
  totalBalance: number
  totalDue: number
  totalPaid: number
}
interface DebtorStudent {
  student: Student
  entries: MonthlyEntry[]
  totalBalance: number
}

export default function AvisPage() {
  const { activeYear, allYears, uid } = useSchoolYear()
  const { fmt, symbol } = useCurrency()

  const [mainTab, setMainTab] = useState<MainTab>('avis')
  const [step, setStep] = useState<Step>('select')
  const [selectedYearId, setSelectedYearId] = useState('')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1)
  const [previewTab, setPreviewTab] = useState<'families' | 'students'>('families')
  const [selectedFeeId, setSelectedFeeId] = useState<string>('')
  const [customMessage, setCustomMessage] = useState('')
  const [useCustomMessage, setUseCustomMessage] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sendingWA, setSendingWA] = useState(false)
  const [waCampaignResult, setWaCampaignResult] = useState<WhatsappResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [wasenderApiKey, setWasenderApiKey] = useState('')
  const [retryPhones, setRetryPhones] = useState<Set<string> | null>(null)

  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [families, setFamilies] = useState<Family[]>([])
  const [fees, setFees] = useState<Fee[]>([])
  const [loadedEntries, setLoadedEntries] = useState<MonthlyEntry[]>([])
  const [schoolInfo, setSchoolInfo] = useState({ name: 'Yassen Academy', address: '', phone: '' })

  const year = allYears.find((y) => y.id === (selectedYearId || activeYear?.id)) ?? activeYear
  const yearId = year?.id ?? ''
  const allYearMonths = year ? getSchoolYearMonths(year) : []

  // Only months that have already started (≤ today)
  const now = new Date()
  const pastMonths = allYearMonths.filter(({ month, year: y }) =>
    y < now.getFullYear() || (y === now.getFullYear() && month <= now.getMonth() + 1)
  )

  // Reset selected month to current if it was a future month
  useEffect(() => {
    const isValid = pastMonths.some((m) => m.month === selectedMonth)
    if (!isValid && pastMonths.length > 0) {
      setSelectedMonth(pastMonths[pastMonths.length - 1].month)
    }
  }, [yearId])

  useEffect(() => {
    if (!yearId || !uid) return
    Promise.all([
      getDocs(query(collection(db, 'students'), where('schoolYearId', '==', yearId), where('userId', '==', uid))),
      getDocs(query(collection(db, 'classes'), where('schoolYearId', '==', yearId), where('userId', '==', uid))),
      getDocs(query(collection(db, 'families'), where('schoolYearId', '==', yearId), where('userId', '==', uid))),
      getDocs(query(collection(db, 'fees'), where('schoolYearId', '==', yearId), where('userId', '==', uid))),
      getDoc(doc(db, 'settings', uid)),
    ]).then(([stuSnap, clsSnap, famSnap, feeSnap, schoolSnap]) => {
      setStudents(stuSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)))
      setClasses(clsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolClass)))
      setFamilies(famSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Family)))
      setFees(feeSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Fee)))
      if (schoolSnap.exists()) {
        const d = schoolSnap.data()
        setSchoolInfo({ name: d.name || 'Yassen Academy', address: d.address || '', phone: d.phone || '' })
        if (d.wasenderApiKey) setWasenderApiKey(d.wasenderApiKey)
      }
    })
  }, [yearId, uid])

  async function loadEntries() {
    if (!yearId || !uid) return
    setLoading(true)

    // Build entries query before Promise.all so TypeScript knows the type
    const entriesQuery = periodMode === 'month'
      ? query(collection(db, 'monthlyEntries'), where('schoolYearId', '==', yearId), where('userId', '==', uid), where('month', '==', selectedMonth))
      : query(collection(db, 'monthlyEntries'), where('schoolYearId', '==', yearId), where('userId', '==', uid))

    // Reload students and fees fresh (reductions/appliedFees may have changed since page load)
    const [stuSnap, feeSnap, entriesSnap] = await Promise.all([
      getDocs(query(collection(db, 'students'), where('schoolYearId', '==', yearId), where('userId', '==', uid))),
      getDocs(query(collection(db, 'fees'), where('schoolYearId', '==', yearId), where('userId', '==', uid))),
      getDocs(entriesQuery),
    ])

    setStudents(stuSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)))
    setFees(feeSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Fee)))

    const allEntries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as MonthlyEntry))
    if (periodMode === 'month') {
      setLoadedEntries(allEntries)
    } else {
      const pastSet = new Set(pastMonths.map((m) => `${m.year}-${m.month}`))
      setLoadedEntries(allEntries.filter((e) => pastSet.has(`${e.year}-${e.month}`)))
    }

    setLoading(false)
    setStep('preview')
  }

  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]))

  // Period label for display
  const periodLabel = periodMode === 'month'
    ? `${MONTHS_FR[selectedMonth - 1]} ${pastMonths.find((m) => m.month === selectedMonth)?.year ?? year?.startYear ?? ''}`
    : `Année ${year?.startYear ?? ''}/${year?.endYear ?? ''} (${pastMonths.length} mois)`

  const feeName = selectedFeeId ? (fees.find((f) => f.id === selectedFeeId)?.name ?? '') : 'Tous les frais'

  // Helper: union of entry.fees + current appliedFees to get all fee lines for one entry
  function resolveEntryFees(
    entry: MonthlyEntry,
    student: Student | undefined,
    filterFeeId: string,
  ): { feeId: string; feeName: string; due: number; paid: number; balance: number }[] {
    const entryFeeMap = new Map(entry.fees.map((ef) => [ef.feeId, ef]))
    const appliedMap = new Map((student?.appliedFees ?? []).map((af) => [af.feeId, af]))
    const allFeeIds = new Set([...entryFeeMap.keys(), ...appliedMap.keys()])

    const lines: { feeId: string; feeName: string; due: number; paid: number; balance: number }[] = []

    for (const fid of allFeeIds) {
      if (filterFeeId && fid !== filterFeeId) continue

      const ef = entryFeeMap.get(fid)
      const af = appliedMap.get(fid)
      const gf = fees.find((f) => f.id === fid)

      let name: string, amount: number, reduction: number, paid: number

      if (ef) {
        // Fee exists in stored entry — use stored amount/name, current reduction
        name = ef.feeName
        amount = ef.amount
        paid = ef.paid
        reduction = af !== undefined ? af.reduction : (ef.reduction ?? 0)
      } else if (af && gf) {
        // Fee applied after entry generation — not yet in entry, paid = 0
        name = gf.name
        amount = gf.monthlyAmount
        paid = 0
        reduction = af.reduction
      } else {
        continue
      }

      const due = Math.max(0, amount - reduction)
      const balance = Math.max(0, due - paid)
      lines.push({ feeId: fid, feeName: name, due, paid, balance })
    }

    return lines
  }

  // Entries with debt — aggregated per student across all loaded months
  const studentDebtMap = useMemo(() => {
    const map: Record<string, { entries: MonthlyEntry[]; totalBalance: number; totalDue: number; totalPaid: number }> = {}
    for (const entry of loadedEntries) {
      const student = students.find((s) => s.id === entry.studentId)

      const lines = resolveEntryFees(entry, student, selectedFeeId)
      const entryDue = lines.reduce((s, l) => s + l.due, 0)
      const entryPaid = lines.reduce((s, l) => s + l.paid, 0)
      const entryBalance = lines.reduce((s, l) => s + l.balance, 0)

      if (entryBalance <= 0) continue
      if (!map[entry.studentId]) map[entry.studentId] = { entries: [], totalBalance: 0, totalDue: 0, totalPaid: 0 }
      map[entry.studentId].entries.push(entry)
      map[entry.studentId].totalBalance += entryBalance
      map[entry.studentId].totalDue += entryDue
      map[entry.studentId].totalPaid += entryPaid
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedEntries, selectedFeeId, students, fees])

  const { debtorFamilies, soloStudents } = useMemo(() => {
    const familiesMap: Record<string, DebtorFamily> = {}
    const solos: DebtorStudent[] = []

    for (const [studentId, agg] of Object.entries(studentDebtMap)) {
      const student = students.find((s) => s.id === studentId)
      if (!student) continue

      if (student.familyId) {
        const fam = families.find((f) => f.id === student.familyId)
        if (!fam) { solos.push({ student, entries: agg.entries, totalBalance: agg.totalBalance }); continue }
        if (!familiesMap[fam.id]) familiesMap[fam.id] = { family: fam, members: [], totalBalance: 0, totalDue: 0, totalPaid: 0 }
        familiesMap[fam.id].members.push({ student, entries: agg.entries })
        familiesMap[fam.id].totalBalance += agg.totalBalance
        familiesMap[fam.id].totalDue += agg.totalDue
        familiesMap[fam.id].totalPaid += agg.totalPaid
      } else {
        solos.push({ student, entries: agg.entries, totalBalance: agg.totalBalance })
      }
    }

    return {
      debtorFamilies: Object.values(familiesMap).sort((a, b) => b.totalBalance - a.totalBalance),
      soloStudents: solos.sort((a, b) => b.totalBalance - a.totalBalance),
    }
  }, [studentDebtMap, students, families])

  const totalDebtors = debtorFamilies.length + soloStudents.length
  const totalStudentsWithDebt = Object.keys(studentDebtMap).length

  function getAutoMessage(concernedCount: number, names: string, periodLbl: string): string {
    const period = periodMode === 'month' ? `le mois de ${periodLbl}` : `l'année scolaire ${periodLbl}`
    const childRef = concernedCount > 1 ? 'vos enfants' : 'votre enfant'
    return `Madame, Monsieur,\n\nNous vous informons qu'un solde impayé est enregistré pour ${period} concernant ${childRef} ${names}.\n\nVeuillez trouver ci-dessous le détail des montants dus.\n\nNous vous prions de bien vouloir régulariser votre situation dans les meilleurs délais.\n\nCordialement,\nLa Direction de ${schoolInfo.name}`
  }

  // ─── WhatsApp Send ───────────────────────────────────────────────────────────

  async function sendWhatsApp() {
    if (!wasenderApiKey) {
      alert("Configurez la clé API WaSenderAPI dans Paramètres d'abord.")
      return
    }

    setSendingWA(true)

    try {

    // Build messages
    const { default: jsPDF } = await import('jspdf')

    type FeeRow = { feeName: string; due: number; paid: number; balance: number }
    type NoticeData = {
      name: string
      className: string
      feeLines: FeeRow[]
      totalBalance: number
      message: string
      phones: string[]
      studentIds: string[]
      familyId?: string
    }

    const notices: NoticeData[] = []

    for (const df of debtorFamilies) {
      const phones: string[] = []
      for (const c of df.family.contacts ?? []) {
        if (c.phone) phones.push(buildFullPhone(c.dialCode || '+242', c.phone))
      }
      const feeLines: FeeRow[] = []
      for (const { student, entries } of df.members) {
        const sorted = [...entries].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
        for (const entry of sorted) {
          const monthPrefix = periodMode === 'year' ? `${MONTHS_FR[entry.month - 1]} — ` : ''
          const namePrefix = `${student.firstName} ${student.lastName} — `
          const lines = resolveEntryFees(entry, student, selectedFeeId)
          for (const l of lines) {
            if (l.balance <= 0) continue
            feeLines.push({ feeName: `${namePrefix}${monthPrefix}${l.feeName}`, due: l.due, paid: l.paid, balance: l.balance })
          }
        }
      }
      if (feeLines.length === 0) continue
      const totalBalance = feeLines.reduce((s, fl) => s + fl.balance, 0)
      const names = df.members.map((m) => `${m.student.firstName} ${m.student.lastName}`).join(', ')
      const message = useCustomMessage && customMessage.trim() ? customMessage.trim() : getAutoMessage(df.members.length, names, periodLabel)
      notices.push({ name: df.family.name, className: classMap[df.members[0]?.student.classId] || '', feeLines, totalBalance, message, phones, studentIds: df.members.map(m => m.student.id), familyId: df.family.id })
    }

    for (const { student, entries } of soloStudents) {
      const phones: string[] = []
      for (const c of student.contacts ?? []) {
        if (c.phone) phones.push(buildFullPhone(c.dialCode || '+242', c.phone))
      }
      const feeLines: FeeRow[] = []
      const sorted = [...entries].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
      for (const entry of sorted) {
        const monthPrefix = periodMode === 'year' ? `${MONTHS_FR[entry.month - 1]} — ` : ''
        const lines = resolveEntryFees(entry, student, selectedFeeId)
        for (const l of lines) {
          if (l.balance <= 0) continue
          feeLines.push({ feeName: `${monthPrefix}${l.feeName}`, due: l.due, paid: l.paid, balance: l.balance })
        }
      }
      if (feeLines.length === 0) continue
      const totalBalance = feeLines.reduce((s, fl) => s + fl.balance, 0)
      const name = `${student.firstName} ${student.lastName}`
      const message = useCustomMessage && customMessage.trim() ? customMessage.trim() : getAutoMessage(1, name, periodLabel)
      notices.push({ name, className: classMap[student.classId] || '', feeLines, totalBalance, message, phones, studentIds: [student.id] })
    }

    // Build API payload
    const messages: { to: string; text: string; pdfBase64: string; filename: string }[] = []
    for (const notice of notices) {
      if (notice.phones.length === 0) continue

      // Generate PDF for this notice
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const A4_W = 210, margin = 12, contentW = A4_W - margin * 2
      let y = margin

      pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0)
      pdf.text(schoolInfo.name, margin, y)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(110, 110, 110)
      if (schoolInfo.address) { y += 4; pdf.text(schoolInfo.address, margin, y) }
      if (schoolInfo.phone) { y += 4; pdf.text(schoolInfo.phone, margin, y) }
      y += 6
      pdf.setDrawColor(0, 209, 255); pdf.setLineWidth(0.5); pdf.line(margin, y, A4_W - margin, y); y += 5
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(0, 0, 0)
      pdf.text('AVIS DE PAIEMENT', margin, y); y += 5
      pdf.setFontSize(8.5); pdf.setTextColor(40, 40, 40); pdf.text(notice.name, margin, y); y += 6
      pdf.setFillColor(245, 247, 250); pdf.rect(margin, y, contentW, 5.5, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(80, 80, 80)
      const col1 = margin + 2, col2 = margin + contentW * 0.55, col3 = margin + contentW * 0.70, col4 = margin + contentW * 0.85
      pdf.text('Désignation', col1, y + 3.8); pdf.text('Dû', col2, y + 3.8); pdf.text('Versé', col3, y + 3.8); pdf.text('Reste', col4, y + 3.8)
      y += 5.5; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7)
      for (const fl of notice.feeLines) {
        pdf.setTextColor(50, 50, 50); pdf.text(fl.feeName, col1, y + 3.5, { maxWidth: contentW * 0.52 })
        pdf.setTextColor(80, 80, 80); pdf.text(fmtPdf(fl.due, symbol), col2, y + 3.5); pdf.text(fmtPdf(fl.paid, symbol), col3, y + 3.5)
        pdf.setTextColor(200, 50, 50); pdf.text(fmtPdf(fl.balance, symbol), col4, y + 3.5); y += 5
      }
      pdf.setDrawColor(210, 210, 210); pdf.setLineWidth(0.3); pdf.line(margin, y, A4_W - margin, y); y += 3.5
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(200, 50, 50)
      pdf.text(`Total restant : ${fmtPdf(notice.totalBalance, symbol)}`, A4_W - margin, y, { align: 'right' }); y += 7
      pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7); pdf.setTextColor(80, 80, 80)
      pdf.text(pdf.splitTextToSize(notice.message, contentW).slice(0, 15), margin, y)
      const pdfBase64 = pdf.output('datauristring').split(',')[1]
      const filename = `Avis_${notice.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
      const feeLines = notice.feeLines.map(fl => `• ${fl.feeName} : ${fmt(fl.balance)} restant`).join('\n')
      const textMsg = `${notice.message}\n\n📋 *Détail des frais impayés :*\n${feeLines}\n\n💰 *Total restant : ${fmt(notice.totalBalance)}*`

      for (const phone of notice.phones) {
        if (retryPhones && !retryPhones.has(phone)) continue
        messages.push({ to: phone, text: textMsg, pdfBase64, filename })
      }
    }

    // Send via WaSenderAPI (text only — no PDF hosting needed)
    let results: WhatsappResult[] = []
    try {
      const sendRes = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: wasenderApiKey, messages: messages.map(m => ({ to: m.to, text: m.text })) }),
      })
      const sendData = await sendRes.json()

      // Aggregate results by notice
      const phoneResultMap: Record<string, { success: boolean; error?: string }> = {}
      for (const r of sendData.results ?? []) {
        phoneResultMap[r.to] = { success: r.success, error: r.error }
      }

      for (const notice of notices) {
        if (notice.phones.length === 0) {
          results.push({ name: notice.name, phones: [], status: 'no_phone', studentIds: notice.studentIds, familyId: notice.familyId })
          continue
        }
        const allOk = notice.phones.every(p => phoneResultMap[p]?.success)
        const anyOk = notice.phones.some(p => phoneResultMap[p]?.success)
        const firstError = notice.phones.map(p => phoneResultMap[p]?.error).find(Boolean)
        results.push({
          name: notice.name, phones: notice.phones,
          status: allOk ? 'sent' : anyOk ? 'sent' : 'failed',
          error: firstError, studentIds: notice.studentIds, familyId: notice.familyId,
        })
      }

      // Also record no_phone notices
      const allNoticeNames = new Set(notices.map(n => n.name))
      for (const df of debtorFamilies) {
        if (!allNoticeNames.has(df.family.name) || (df.family.contacts ?? []).every(c => !c.phone)) {
          results.push({ name: df.family.name, phones: [], status: 'no_phone', studentIds: df.members.map(m => m.student.id), familyId: df.family.id })
        }
      }
      for (const { student } of soloStudents) {
        const name = `${student.firstName} ${student.lastName}`
        if (!allNoticeNames.has(name) || (student.contacts ?? []).every(c => !c.phone)) {
          results.push({ name, phones: [], status: 'no_phone', studentIds: [student.id] })
        }
      }
    } catch {
      results = notices.map(n => ({ name: n.name, phones: n.phones, status: 'failed' as const, error: 'Erreur réseau', studentIds: n.studentIds, familyId: n.familyId }))
    }

    // Save campaign to Firestore (silently — don't block UI if it fails)
    if (uid && yearId) {
      try {
        const sentCount = results.filter(r => r.status === 'sent').length
        const failedCount = results.filter(r => r.status === 'failed').length
        const noPhoneCount = results.filter(r => r.status === 'no_phone').length
        const cleanResults = results.map(r => ({
          name: r.name,
          phones: r.phones,
          status: r.status,
          studentIds: r.studentIds ?? [],
          ...(r.familyId ? { familyId: r.familyId } : {}),
          ...(r.error ? { error: r.error } : {}),
        }))
        await addDoc(collection(db, 'whatsappCampaigns'), {
          createdAt: new Date().toISOString(),
          periodLabel,
          schoolYearId: yearId,
          userId: uid,
          results: cleanResults,
          sentCount,
          failedCount,
          noPhoneCount,
        })
      } catch { /* ignore */ }
    }

    setRetryPhones(null)
    setWaCampaignResult(results)
    setStep('select')
    setLoadedEntries([])

    } catch (err) {
      console.error('[WA] Send error:', err)
      alert('Erreur lors de l\'envoi : ' + String(err))
    } finally {
      setSendingWA(false)
    }
  }

  // ─── PDF Generation ─────────────────────────────────────────────────────────

  async function generatePDFs() {
    setGenerating(true)
    try {
      const { default: jsPDF } = await import('jspdf')

      type FeeRow = { feeName: string; due: number; paid: number; balance: number }
      type Notice = {
        title: string
        className: string
        feeLines: FeeRow[]
        totalBalance: number
        message: string
      }

      const notices: Notice[] = []

      // ── Family notices ──
      for (const df of debtorFamilies) {
        const feeLines: FeeRow[] = []
        for (const { student, entries } of df.members) {
          const sorted = [...entries].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
          for (const entry of sorted) {
            const monthPrefix = periodMode === 'year' ? `${MONTHS_FR[entry.month - 1]} — ` : ''
            const namePrefix = `${student.firstName} ${student.lastName} — `
            const lines = resolveEntryFees(entry, student, selectedFeeId)
            for (const l of lines) {
              if (l.balance <= 0) continue
              feeLines.push({ feeName: `${namePrefix}${monthPrefix}${l.feeName}`, due: l.due, paid: l.paid, balance: l.balance })
            }
          }
        }
        if (feeLines.length === 0) continue
        const totalBalance = feeLines.reduce((s, fl) => s + fl.balance, 0)
        const names = df.members.map((m) => `${m.student.firstName} ${m.student.lastName}`).join(', ')
        const message = useCustomMessage && customMessage.trim()
          ? customMessage.trim()
          : getAutoMessage(df.members.length, names, periodLabel)
        const cls = classMap[df.members[0]?.student.classId] || 'Sans classe'
        notices.push({ title: df.family.name, className: cls, feeLines, totalBalance, message })
      }

      // ── Solo student notices ──
      for (const { student, entries } of soloStudents) {
        const feeLines: FeeRow[] = []
        const sorted = [...entries].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
        for (const entry of sorted) {
          const monthPrefix = periodMode === 'year' ? `${MONTHS_FR[entry.month - 1]} — ` : ''
          const lines = resolveEntryFees(entry, student, selectedFeeId)
          for (const l of lines) {
            if (l.balance <= 0) continue
            feeLines.push({ feeName: `${monthPrefix}${l.feeName}`, due: l.due, paid: l.paid, balance: l.balance })
          }
        }
        if (feeLines.length === 0) continue
        const totalBalance = feeLines.reduce((s, fl) => s + fl.balance, 0)
        const name = `${student.firstName} ${student.lastName}`
        const message = useCustomMessage && customMessage.trim()
          ? customMessage.trim()
          : getAutoMessage(1, name, periodLabel)
        const cls = classMap[student.classId] || 'Sans classe'
        notices.push({ title: name, className: cls, feeLines, totalBalance, message })
      }

      if (notices.length === 0) { setGenerating(false); return }

      const byClass: Record<string, Notice[]> = {}
      for (const n of notices) {
        if (!byClass[n.className]) byClass[n.className] = []
        byClass[n.className].push(n)
      }

      const A4_W = 210
      const A4_H = 297
      const HALF_H = A4_H / 2

      const periodSlug = periodMode === 'month'
        ? periodLabel.replace(/\s+/g, '_')
        : `Annee_${year?.startYear}_${year?.endYear}`

      for (const [className, classNotices] of Object.entries(byClass)) {
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

        for (let i = 0; i < classNotices.length; i++) {
          const notice = classNotices[i]
          const isSecond = i % 2 === 1
          const yOffset = isSecond ? HALF_H : 0

          if (i > 0 && i % 2 === 0) pdf.addPage()

          if (isSecond) {
            pdf.setDrawColor(180, 180, 180)
            ;(pdf as any).setLineDash([3, 3])
            pdf.line(10, yOffset, A4_W - 10, yOffset)
            ;(pdf as any).setLineDash([])
            // Scissors hint
            pdf.setFontSize(6)
            pdf.setTextColor(160, 160, 160)
            pdf.text('✂', 6, yOffset + 1)
          }

          const margin = 12
          const contentW = A4_W - margin * 2
          let y = yOffset + margin

          // School header (left)
          pdf.setFontSize(10)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(0, 0, 0)
          pdf.text(schoolInfo.name, margin, y)
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(7.5)
          pdf.setTextColor(110, 110, 110)
          if (schoolInfo.address) { y += 4; pdf.text(schoolInfo.address, margin, y) }
          if (schoolInfo.phone) { y += 4; pdf.text(schoolInfo.phone, margin, y) }

          // Period & class (right)
          const headerY = yOffset + margin
          pdf.setFontSize(7.5)
          pdf.setTextColor(110, 110, 110)
          pdf.text(periodMode === 'month' ? `Mois : ${periodLabel}` : periodLabel, A4_W - margin, headerY, { align: 'right' })
          pdf.text(`Classe : ${className}`, A4_W - margin, headerY + 4, { align: 'right' })

          y += 6

          // Cyan divider
          pdf.setDrawColor(0, 209, 255)
          pdf.setLineWidth(0.5)
          pdf.line(margin, y, A4_W - margin, y)
          y += 5

          // Title
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(9)
          pdf.setTextColor(0, 0, 0)
          pdf.text('AVIS DE PAIEMENT', margin, y)
          y += 5
          pdf.setFontSize(8.5)
          pdf.setTextColor(40, 40, 40)
          pdf.text(notice.title, margin, y)
          y += 6

          // Fee table
          // Header
          pdf.setFillColor(245, 247, 250)
          pdf.rect(margin, y, contentW, 5.5, 'F')
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(7)
          pdf.setTextColor(80, 80, 80)
          const col1 = margin + 2
          const col2 = margin + contentW * 0.55
          const col3 = margin + contentW * 0.70
          const col4 = margin + contentW * 0.85
          pdf.text('Désignation', col1, y + 3.8)
          pdf.text('Dû', col2, y + 3.8)
          pdf.text('Versé', col3, y + 3.8)
          pdf.text('Reste', col4, y + 3.8)
          y += 5.5

          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(7)
          const maxY = yOffset + HALF_H - 18

          for (const fl of notice.feeLines) {
            if (y + 5 > maxY) break
            const rowH = 5
            pdf.setTextColor(50, 50, 50)
            pdf.text(fl.feeName, col1, y + rowH * 0.7, { maxWidth: contentW * 0.52 })
            pdf.setTextColor(80, 80, 80)
            pdf.text(fmtPdf(fl.due, symbol), col2, y + rowH * 0.7)
            pdf.text(fmtPdf(fl.paid, symbol), col3, y + rowH * 0.7)
            pdf.setTextColor(200, 50, 50)
            pdf.text(fmtPdf(fl.balance, symbol), col4, y + rowH * 0.7)
            y += rowH
          }

          // Total
          pdf.setDrawColor(210, 210, 210)
          pdf.setLineWidth(0.3)
          pdf.line(margin, y, A4_W - margin, y)
          y += 3.5
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.setTextColor(200, 50, 50)
          pdf.text(`Total restant : ${fmtPdf(notice.totalBalance, symbol)}`, A4_W - margin, y, { align: 'right' })
          y += 7

          // Message body
          const msgMaxH = maxY - y - 2
          if (msgMaxH > 6) {
            pdf.setFont('helvetica', 'italic')
            pdf.setFontSize(7)
            pdf.setTextColor(80, 80, 80)
            const msgLines = pdf.splitTextToSize(notice.message, contentW)
            const linesPerMm = 4
            const maxLines = Math.floor(msgMaxH / linesPerMm)
            pdf.text(msgLines.slice(0, maxLines), margin, y)
          }

          // Signature
          const sigY = yOffset + HALF_H - 8
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(7)
          pdf.setTextColor(140, 140, 140)
          pdf.text('Signature du parent / tuteur : ____________________________', margin, sigY)
        }

        const safeClass = className.replace(/[^a-zA-Z0-9À-ÿ\s\-]/g, '').trim()
        pdf.save(`Avis_${periodSlug}_${safeClass}.pdf`)
        await new Promise((r) => setTimeout(r, 400))
      }

      // ← Return to step 1 after all downloads
      setStep('select')
      setLoadedEntries([])
    } finally {
      setGenerating(false)
    }
  }

  if (!year) return <div className="p-8"><p className="text-slate-500 text-sm">Aucune année scolaire active.</p></div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/finance" className="text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Avis de paiement</h1>
          <p className="text-slate-500 text-sm mt-0.5">PDF ou envoi WhatsApp automatique</p>
        </div>
      </div>

      {/* Main tabs */}
      <div className="flex rounded-xl bg-slate-100 p-0.5 w-fit mb-8">
        <button onClick={() => setMainTab('avis')}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${mainTab === 'avis' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          Générer des avis
        </button>
        <button onClick={() => setMainTab('campagnes')}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${mainTab === 'campagnes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          Campagnes WhatsApp
        </button>
      </div>


      {/* Campaign result summary */}
      {waCampaignResult && (
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 text-sm">Résultat de l'envoi</h3>
            <button onClick={() => setWaCampaignResult(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-3 bg-emerald-50 rounded-xl">
              <p className="text-xl font-bold text-emerald-600">{waCampaignResult.filter(r => r.status === 'sent').length}</p>
              <p className="text-xs text-emerald-700 mt-0.5">Envoyés</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-xl">
              <p className="text-xl font-bold text-red-500">{waCampaignResult.filter(r => r.status === 'failed').length}</p>
              <p className="text-xs text-red-600 mt-0.5">Échoués</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-xl">
              <p className="text-xl font-bold text-amber-500">{waCampaignResult.filter(r => r.status === 'no_phone').length}</p>
              <p className="text-xs text-amber-600 mt-0.5">Sans numéro</p>
            </div>
          </div>
          <button onClick={() => setMainTab('campagnes')} className="text-sm text-[#00D1FF] hover:underline">
            Voir le détail dans Campagnes →
          </button>
        </div>
      )}

      {mainTab === 'campagnes' && <CampagnesTab uid={uid ?? ''} yearId={yearId} fmt={fmt} wasenderApiKey={wasenderApiKey} onRetry={(phones) => { setRetryPhones(phones); setMainTab('avis'); loadEntries() }} />}

      {mainTab === 'avis' && <>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {(['select', 'preview', 'generate'] as Step[]).map((s, i) => {
          const idx = ['select', 'preview', 'generate'].indexOf(s)
          const curIdx = ['select', 'preview', 'generate'].indexOf(step)
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step === s ? 'bg-[#00D1FF] text-white' : idx < curIdx ? 'bg-emerald-400 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {i + 1}
              </div>
              <span className={`text-sm font-medium ${step === s ? 'text-slate-900' : 'text-slate-400'}`}>
                {s === 'select' ? 'Sélection' : s === 'preview' ? 'Aperçu' : 'Génération'}
              </span>
              {i < 2 && <div className="w-8 h-px bg-slate-200 mx-1" />}
            </div>
          )
        })}
      </div>

      {/* ── STEP 1: Select ── */}
      {step === 'select' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-sm font-bold text-slate-900 mb-4">Paramètres</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Année scolaire</label>
                <select value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]">
                  <option value="">Année en cours</option>
                  {allYears.map((y) => <option key={y.id} value={y.id}>{y.startYear}/{y.endYear}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Frais concerné</label>
                <select value={selectedFeeId} onChange={(e) => setSelectedFeeId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]">
                  <option value="">Tous les frais</option>
                  {fees.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>

            {/* Period mode toggle */}
            <div className="mt-5">
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Période</label>
              <div className="flex rounded-xl bg-slate-100 p-0.5 w-fit mb-4">
                <button onClick={() => setPeriodMode('month')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${periodMode === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Un mois
                </button>
                <button onClick={() => setPeriodMode('year')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${periodMode === 'year' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Année complète
                </button>
              </div>

              {periodMode === 'month' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Mois concerné</label>
                  <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    className="w-full max-w-xs px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]">
                    {pastMonths.map(({ month, year: y }) => (
                      <option key={`${y}-${month}`} value={month}>{MONTHS_FR[month - 1]} {y}</option>
                    ))}
                  </select>
                  {pastMonths.length === 0 && (
                    <p className="text-xs text-amber-600 mt-2">Aucun mois passé pour cette année scolaire.</p>
                  )}
                </div>
              )}

              {periodMode === 'year' && (
                <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600 border border-slate-100">
                  Les avis couvriront <strong>{pastMonths.length} mois</strong> écoulés de l'année {year.startYear}/{year.endYear}
                  {pastMonths.length > 0 && (
                    <span className="text-slate-400 ml-1">
                      ({MONTHS_FR[pastMonths[0].month - 1]} → {MONTHS_FR[pastMonths[pastMonths.length - 1].month - 1]})
                    </span>
                  )}
                  . Les mois futurs sont exclus.
                </div>
              )}
            </div>
          </div>

          <button onClick={loadEntries} disabled={loading || pastMonths.length === 0}
            className="w-full py-3 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {loading ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Chargement…</>
            ) : 'Charger les données →'}
          </button>
        </div>
      )}

      {/* ── STEP 2: Preview ── */}
      {step === 'preview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{totalStudentsWithDebt}</p>
              <p className="text-xs text-slate-500 mt-1">Élèves en retard</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-bold text-[#00D1FF]">{debtorFamilies.length}</p>
              <p className="text-xs text-slate-500 mt-1">Avis familles</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-bold text-slate-700">{soloStudents.length}</p>
              <p className="text-xs text-slate-500 mt-1">Avis élèves seuls</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 px-4 py-3 text-xs text-slate-500">
            Période : <strong className="text-slate-900">{periodLabel}</strong> · Frais : <strong className="text-slate-900">{feeName}</strong>
          </div>

          <div className="flex rounded-xl bg-slate-100 p-0.5 w-fit">
            {(['families', 'students'] as const).map((t) => (
              <button key={t} onClick={() => setPreviewTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${previewTab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t === 'families' ? `Familles (${debtorFamilies.length})` : `Élèves seuls (${soloStudents.length})`}
              </button>
            ))}
          </div>

          {previewTab === 'families' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              {debtorFamilies.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">Aucune famille en retard.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Famille</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Enfants</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Classe</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Reste</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {debtorFamilies.map((df) => (
                      <tr key={df.family.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{df.family.name}</td>
                        <td className="px-5 py-3 text-slate-600 text-xs">{df.members.map((m) => `${m.student.firstName} ${m.student.lastName}`).join(', ')}</td>
                        <td className="px-5 py-3 text-slate-500 text-xs">{classMap[df.members[0]?.student.classId] || '—'}</td>
                        <td className="px-5 py-3 text-right font-semibold text-red-500">{fmt(df.totalBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {previewTab === 'students' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              {soloStudents.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">Aucun élève hors famille en retard.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Élève</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Classe</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Reste</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {soloStudents.map(({ student, totalBalance }) => (
                      <tr key={student.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{student.firstName} {student.lastName}</td>
                        <td className="px-5 py-3 text-slate-500">{classMap[student.classId] || '—'}</td>
                        <td className="px-5 py-3 text-right font-semibold text-red-500">{fmt(totalBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setStep('select'); setLoadedEntries([]) }}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
              ← Retour
            </button>
            <button onClick={() => setStep('generate')} disabled={totalDebtors === 0}
              className="flex-1 py-2.5 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold hover:bg-[#00b8e0] disabled:opacity-50 transition-colors">
              Personnaliser et générer →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Generate ── */}
      {step === 'generate' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-sm font-bold text-slate-900 mb-4">Message aux parents</h2>
            <div className="flex rounded-xl bg-slate-100 p-0.5 w-fit mb-5">
              <button onClick={() => setUseCustomMessage(false)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${!useCustomMessage ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Message automatique
              </button>
              <button onClick={() => setUseCustomMessage(true)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${useCustomMessage ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Message personnalisé
              </button>
            </div>

            {!useCustomMessage ? (
              <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 italic border border-slate-100 space-y-1">
                <p className="font-semibold text-slate-700 not-italic mb-2">Aperçu du message automatique :</p>
                <p>Madame, Monsieur,</p>
                <p>Nous vous informons qu'un solde impayé est enregistré pour {periodMode === 'month' ? `le mois de ${periodLabel}` : `l'année scolaire ${periodLabel}`} concernant votre enfant / vos enfants [NOM(S)].</p>
                <p className="text-slate-400">[Tableau des frais impayés]</p>
                <p>Nous vous prions de bien vouloir régulariser votre situation dans les meilleurs délais.</p>
                <p>Cordialement, La Direction de {schoolInfo.name}</p>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-500 mb-2">Votre message uniquement — le tableau des frais sera ajouté automatiquement.</p>
                <textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} rows={6}
                  placeholder={`Madame, Monsieur,\n\nVeuillez trouver ci-dessous le récapitulatif des frais impayés.\n\nCordialement`}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF] resize-none" />
              </div>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            <p className="font-semibold mb-1">Organisation des fichiers</p>
            <p>Un PDF par classe, nommé <code className="bg-amber-100 px-1 rounded text-xs">Avis_[Période]_[Classe].pdf</code>. Chaque page A4 contient 2 avis découpables. Après téléchargement, vous reviendrez à l'étape 1.</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <p className="text-sm font-medium text-slate-700 mb-3">Résumé de la génération</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xl font-bold text-slate-900">{totalDebtors}</p><p className="text-xs text-slate-500">Avis au total</p></div>
              <div><p className="text-xl font-bold text-[#00D1FF]">{Object.keys(classes.reduce((m, c) => ({ ...m, [c.id]: true }), {})).length}</p><p className="text-xs text-slate-500">Fichiers PDF max</p></div>
              <div><p className="text-xl font-bold text-slate-700">{Math.ceil(totalDebtors / 2)}</p><p className="text-xs text-slate-500">Pages A4 max</p></div>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button onClick={() => setStep('preview')} className="py-2.5 px-5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">
              ← Retour
            </button>
            <button onClick={generatePDFs} disabled={generating || sendingWA || totalDebtors === 0}
              className="flex-1 py-3 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {generating ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Génération…</>
              ) : (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  PDF ({totalDebtors} avis)</>
              )}
            </button>
            <button onClick={sendWhatsApp} disabled={generating || sendingWA || totalDebtors === 0}
              className="flex-1 py-3 bg-[#25D366] text-white rounded-xl text-sm font-semibold hover:bg-[#1ebe5a] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {sendingWA ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Envoi en cours…</>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  Envoyer sur WhatsApp ({totalDebtors} avis)
                </>
              )}
            </button>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}

// ─── Campagnes Tab ────────────────────────────────────────────────────────────

function CampagnesTab({ uid, yearId, fmt, wasenderApiKey, onRetry }: {
  uid: string
  yearId: string
  fmt: (n: number) => string
  wasenderApiKey: string
  onRetry: (failedPhones: Set<string>) => void
}) {
  const [campaigns, setCampaigns] = useState<import('../../../_lib/types').WhatsappCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed' | 'no_phone'>('all')

  useEffect(() => {
    if (!uid || !yearId) return
    setLoading(true)
    setError(false)
    getDocs(query(
      collection(db, 'whatsappCampaigns'),
      where('userId', '==', uid),
      where('schoolYearId', '==', yearId),
    )).then(snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as import('../../../_lib/types').WhatsappCampaign))
      data.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setCampaigns(data)
    }).catch(() => setError(true))
    .finally(() => setLoading(false))
  }, [uid, yearId])

  const selected = campaigns.find(c => c.id === selectedId)

  if (loading) return <div className="flex justify-center py-12"><span className="w-6 h-6 border-2 border-[#00D1FF] border-t-transparent rounded-full animate-spin" /></div>

  if (error) return (
    <div className="text-center py-16 text-slate-400">
      <p className="text-sm font-medium text-red-400">Impossible de charger les campagnes.</p>
      <p className="text-xs mt-1">Vérifiez votre connexion ou les règles Firestore.</p>
    </div>
  )

  if (campaigns.length === 0) return (
    <div className="text-center py-16 text-slate-400">
      <div className="text-4xl mb-3">📭</div>
      <p className="text-sm font-medium">Aucune campagne WhatsApp pour cette année scolaire.</p>
      <p className="text-xs mt-1">Envoyez vos premiers avis via l'onglet "Générer des avis".</p>
    </div>
  )

  if (selected) {
    const filtered = filter === 'all' ? selected.results : selected.results.filter(r => r.status === filter)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="font-bold text-slate-900 text-sm">Campagne — {selected.periodLabel}</h2>
            <p className="text-xs text-slate-400">{new Date(selected.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
            <p className="text-xl font-bold text-emerald-600">{selected.sentCount}</p>
            <p className="text-xs text-emerald-700 mt-0.5">Envoyés</p>
          </div>
          <div className="text-center p-3 bg-red-50 rounded-xl border border-red-100">
            <p className="text-xl font-bold text-red-500">{selected.failedCount}</p>
            <p className="text-xs text-red-600 mt-0.5">Échoués</p>
          </div>
          <div className="text-center p-3 bg-amber-50 rounded-xl border border-amber-100">
            <p className="text-xl font-bold text-amber-500">{selected.noPhoneCount}</p>
            <p className="text-xs text-amber-600 mt-0.5">Sans numéro</p>
          </div>
        </div>

        {/* Retry button */}
        {(selected.failedCount > 0) && (
          <button
            onClick={() => {
              const failedPhones = new Set(
                selected.results.filter(r => r.status === 'failed').flatMap(r => r.phones)
              )
              onRetry(failedPhones)
            }}
            className="w-full py-2.5 rounded-xl bg-[#25D366] text-white text-sm font-semibold flex items-center justify-center gap-2">
            🔄 Réessayer pour les {selected.failedCount} échec(s) seulement
          </button>
        )}

        {/* Filters */}
        <div className="flex gap-1.5 flex-wrap overflow-x-auto pb-1">
          {(['all', 'sent', 'failed', 'no_phone'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${filter === f
                ? f === 'sent' ? 'bg-emerald-500 text-white border-emerald-500'
                  : f === 'failed' ? 'bg-red-500 text-white border-red-500'
                  : f === 'no_phone' ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}>
              {f === 'all' ? `Tous (${selected.results.length})`
                : f === 'sent' ? `✓ Envoyés (${selected.sentCount})`
                : f === 'failed' ? `✗ Échoués (${selected.failedCount})`
                : `— Sans numéro (${selected.noPhoneCount})`}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? <p className="text-slate-400 text-sm text-center py-8">Aucun résultat pour ce filtre.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Nom</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Numéro(s)</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs font-mono">
                      {r.phones.length > 0 ? r.phones.join(', ') : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {r.status === 'sent' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">✓ Envoyé</span>}
                      {r.status === 'failed' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600" title={r.error}>
                          ✗ {r.error === 'not_on_whatsapp' ? 'Pas sur WhatsApp' : 'Échec'}
                        </span>
                      )}
                      {r.status === 'no_phone' && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-600">— Pas de numéro</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {campaigns.map(c => (
        <button key={c.id} onClick={() => { setSelectedId(c.id); setFilter('all') }}
          className="w-full text-left bg-white rounded-xl shadow-sm border border-slate-100 p-4 hover:border-[#00D1FF]/30 transition-all flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-slate-900 text-sm">{c.periodLabel}</p>
            <p className="text-xs text-slate-400 mt-0.5">{new Date(c.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">{c.sentCount} envoyés</span>
            {c.failedCount > 0 && <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-1 rounded-lg">{c.failedCount} échoués</span>}
            {c.noPhoneCount > 0 && <span className="text-xs font-medium text-amber-500 bg-amber-50 px-2 py-1 rounded-lg">{c.noPhoneCount} sans numéro</span>}
            <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </button>
      ))}
    </div>
  )
}
