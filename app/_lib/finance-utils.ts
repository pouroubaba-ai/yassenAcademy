import { Fee, MonthlyEntry, MonthlyEntryFee, PaymentAllocation, SchoolYear, Student } from './types'

/**
 * Recompute an entry's fees dynamically, date-aware:
 *
 * - PAST months  (< current month): return entry as-is — never touch historical data
 * - CURRENT month (= today's month): add new fees from appliedFees not yet in entry;
 *     keep stored amount & reduction for existing fees (already partially paid)
 * - FUTURE months (> current month): use current fee amount (gf.monthlyAmount),
 *     current reduction (af.reduction), and add new fees
 */
export function resolveEntry(
  entry: MonthlyEntry,
  student: Pick<Student, 'appliedFees'> | undefined,
  allFees: Pick<Fee, 'id' | 'name' | 'monthlyAmount'>[],
): MonthlyEntry {
  const now = new Date()
  const nowMonth = now.getMonth() + 1
  const nowYear = now.getFullYear()

  const isFuture = entry.year > nowYear || (entry.year === nowYear && entry.month > nowMonth)
  const isCurrent = entry.year === nowYear && entry.month === nowMonth

  // Past months: never modify — keep stored data exactly as-is
  if (!isFuture && !isCurrent) return entry

  const entryFeeMap = new Map(entry.fees.map((ef) => [ef.feeId, ef]))
  const appliedMap = new Map((student?.appliedFees ?? []).map((af) => [af.feeId, af]))
  const allFeeIds = new Set([...entryFeeMap.keys(), ...appliedMap.keys()])

  const resolvedFees: MonthlyEntryFee[] = []
  for (const fid of allFeeIds) {
    const ef = entryFeeMap.get(fid)
    const af = appliedMap.get(fid)
    const gf = allFees.find((f) => f.id === fid)

    let feeName: string, amount: number, reduction: number, paid: number

    if (ef) {
      feeName = ef.feeName
      paid = ef.paid
      if (isFuture) {
        // Future: use current fee amount and current reduction
        amount = gf ? gf.monthlyAmount : ef.amount
        reduction = af !== undefined ? af.reduction : (ef.reduction ?? 0)
      } else {
        // Current month: keep stored amount & reduction (already potentially paid)
        amount = ef.amount
        reduction = ef.reduction ?? 0
      }
    } else if (af && gf) {
      // New fee added after entry was generated — show for current and future
      feeName = gf.name
      amount = gf.monthlyAmount
      paid = 0
      reduction = af.reduction
    } else {
      continue
    }

    const due = Math.max(0, amount - reduction)
    const balance = Math.max(0, due - paid)
    resolvedFees.push({ feeId: fid, feeName, amount, reduction, due, paid, balance })
  }

  const totalDue = resolvedFees.reduce((s, r) => s + r.due, 0)
  const totalPaid = resolvedFees.reduce((s, r) => s + r.paid, 0)
  const totalBalance = resolvedFees.reduce((s, r) => s + r.balance, 0)
  return { ...entry, fees: resolvedFees, totalDue, totalPaid, totalBalance }
}

export const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export function getSchoolYearMonths(year: SchoolYear): { month: number; year: number }[] {
  const months: { month: number; year: number }[] = []
  let m = year.startMonth
  let y = year.startYear
  while (y < year.endYear || (y === year.endYear && m <= year.endMonth)) {
    months.push({ month: m, year: y })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

export function getMonthsUpToNow(schoolYear: SchoolYear): { month: number; year: number }[] {
  const all = getSchoolYearMonths(schoolYear)
  const now = new Date()
  const cm = now.getMonth() + 1
  const cy = now.getFullYear()
  return all.filter(({ month, year }) => year < cy || (year === cy && month <= cm))
}

export function monthLabel(month: number, year: number): string {
  return `${MONTHS_FR[month - 1]} ${year}`
}

/** Allocate `amount` across a student's entries, oldest month first, fee by fee */
export function allocatePayment(
  entries: MonthlyEntry[],
  amount: number,
  selectedFeeIds: string[],
): PaymentAllocation[] {
  const allocations: PaymentAllocation[] = []
  let remaining = Math.round(amount * 100) / 100

  const sorted = [...entries].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  )

  for (const entry of sorted) {
    if (remaining <= 0.005) break
    for (const ef of entry.fees) {
      if (remaining <= 0.005) break
      if (!selectedFeeIds.includes(ef.feeId)) continue
      if (ef.balance <= 0.005) continue
      const allocate = Math.min(remaining, ef.balance)
      const rounded = Math.round(allocate * 100) / 100
      allocations.push({
        monthlyEntryId: entry.id,
        studentId: entry.studentId,
        feeId: ef.feeId,
        feeName: ef.feeName,
        month: entry.month,
        year: entry.year,
        amount: rounded,
      })
      remaining -= rounded
    }
  }

  return allocations
}

/**
 * Distribute a family payment equally among members, then redistribute excess.
 * Returns allocations and an optional warning if the total couldn't be fully absorbed.
 */
export function allocateFamilyPayment(
  entriesByStudent: Record<string, MonthlyEntry[]>,
  studentIds: string[],
  totalAmount: number,
  selectedFeeIds: string[],
): { allocations: PaymentAllocation[]; warning: string | null } {
  if (studentIds.length === 0) return { allocations: [], warning: null }

  // Max each student can absorb on selected fees
  const maxPerStudent: Record<string, number> = {}
  for (const sid of studentIds) {
    const entries = entriesByStudent[sid] ?? []
    maxPerStudent[sid] = entries
      .flatMap((e) => e.fees)
      .filter((ef) => selectedFeeIds.includes(ef.feeId))
      .reduce((s, ef) => s + ef.balance, 0)
  }

  // Iterative equal-share distribution with overflow redistribution
  let remaining = Math.round(totalAmount * 100) / 100
  const toAllocate: Record<string, number> = Object.fromEntries(studentIds.map((s) => [s, 0]))
  const pending = new Set(studentIds)

  while (pending.size > 0 && remaining > 0.005) {
    const share = remaining / pending.size
    const saturated: string[] = []

    for (const sid of pending) {
      const canAbsorb = maxPerStudent[sid] - toAllocate[sid]
      if (canAbsorb <= share + 0.005) {
        toAllocate[sid] += canAbsorb
        remaining -= canAbsorb
        saturated.push(sid)
      }
    }

    if (saturated.length === 0) {
      // All remaining can absorb their share
      for (const sid of pending) {
        toAllocate[sid] += share
      }
      remaining = 0
      break
    }
    for (const sid of saturated) pending.delete(sid)
  }

  const warning =
    remaining > 0.5
      ? `${Math.round(remaining)} n'a pas pu être alloué — dettes insuffisantes`
      : null

  const allAllocations: PaymentAllocation[] = []
  for (const sid of studentIds) {
    const amt = toAllocate[sid]
    if (amt <= 0.005) continue
    const entries = entriesByStudent[sid] ?? []
    allAllocations.push(...allocatePayment(entries, amt, selectedFeeIds))
  }

  return { allocations: allAllocations, warning }
}

/** Compute updated entry fees after applying allocations (for preview + optimistic update) */
export function applyAllocationsToEntries(
  entries: MonthlyEntry[],
  allocations: PaymentAllocation[],
): MonthlyEntry[] {
  const byEntry: Record<string, PaymentAllocation[]> = {}
  for (const a of allocations) {
    if (!byEntry[a.monthlyEntryId]) byEntry[a.monthlyEntryId] = []
    byEntry[a.monthlyEntryId].push(a)
  }

  return entries.map((entry) => {
    const allocs = byEntry[entry.id]
    if (!allocs) return entry

    const updatedFees = entry.fees.map((ef) => {
      const allocated = allocs
        .filter((a) => a.feeId === ef.feeId)
        .reduce((s, a) => s + a.amount, 0)
      if (allocated <= 0) return ef
      const newPaid = ef.paid + allocated
      const newBalance = Math.max(0, ef.due - newPaid)
      return { ...ef, paid: newPaid, balance: newBalance }
    })

    const totalPaid = updatedFees.reduce((s, ef) => s + ef.paid, 0)
    const totalBalance = updatedFees.reduce((s, ef) => s + ef.balance, 0)
    return { ...entry, fees: updatedFees, totalPaid, totalBalance }
  })
}

/** Reverse (cancel) a payment's allocations on entries */
export function reverseAllocationsOnEntries(
  entries: MonthlyEntry[],
  allocations: PaymentAllocation[],
): MonthlyEntry[] {
  const byEntry: Record<string, PaymentAllocation[]> = {}
  for (const a of allocations) {
    if (!byEntry[a.monthlyEntryId]) byEntry[a.monthlyEntryId] = []
    byEntry[a.monthlyEntryId].push(a)
  }
  return entries.map((entry) => {
    const allocs = byEntry[entry.id]
    if (!allocs) return entry
    const updatedFees = entry.fees.map((ef) => {
      const reversed = allocs.filter((a) => a.feeId === ef.feeId).reduce((s, a) => s + a.amount, 0)
      if (reversed <= 0) return ef
      const newPaid = Math.max(0, ef.paid - reversed)
      return { ...ef, paid: newPaid, balance: ef.due - newPaid }
    })
    const totalPaid = updatedFees.reduce((s, ef) => s + ef.paid, 0)
    const totalBalance = updatedFees.reduce((s, ef) => s + ef.balance, 0)
    return { ...entry, fees: updatedFees, totalPaid, totalBalance }
  })
}

/** Build a virtual (unsaved) MonthlyEntry for a future month based on student's current appliedFees */
export function buildVirtualEntry(
  studentId: string,
  schoolYearId: string,
  month: number,
  year: number,
  appliedFees: { feeId: string; reduction: number }[],
  fees: { id: string; name: string; monthlyAmount: number }[],
): Omit<MonthlyEntry, 'id' | 'generatedAt'> & { id: '__virtual__' } {
  const entryFees: MonthlyEntryFee[] = []
  let totalDue = 0
  for (const af of appliedFees) {
    const fee = fees.find((f) => f.id === af.feeId)
    if (!fee) continue
    const due = Math.max(0, fee.monthlyAmount - af.reduction)
    entryFees.push({ feeId: fee.id, feeName: fee.name, amount: fee.monthlyAmount, reduction: af.reduction, due, paid: 0, balance: due })
    totalDue += due
  }
  return { id: '__virtual__', studentId, schoolYearId, month, year, isActive: true, fees: entryFees, totalDue, totalPaid: 0, totalBalance: totalDue }
}

/** Aggregate entries for a list of students into a single summary row (for family view) */
export function aggregateEntries(entries: MonthlyEntry[]): {
  totalDue: number
  totalPaid: number
  totalBalance: number
  byFee: Record<string, { feeName: string; due: number; paid: number; balance: number }>
} {
  const byFee: Record<string, { feeName: string; due: number; paid: number; balance: number }> = {}
  let totalDue = 0, totalPaid = 0, totalBalance = 0

  for (const entry of entries) {
    totalDue += entry.totalDue
    totalPaid += entry.totalPaid
    totalBalance += entry.totalBalance
    for (const ef of entry.fees) {
      if (!byFee[ef.feeId]) byFee[ef.feeId] = { feeName: ef.feeName, due: 0, paid: 0, balance: 0 }
      byFee[ef.feeId].due += ef.due
      byFee[ef.feeId].paid += ef.paid
      byFee[ef.feeId].balance += ef.balance
    }
  }

  return { totalDue, totalPaid, totalBalance, byFee }
}
