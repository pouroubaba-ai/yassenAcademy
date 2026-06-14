import {
  collection, query, where, getDocs, addDoc, Firestore,
} from 'firebase/firestore'
import { SchoolYear, Student, Fee, MonthlyEntryFee } from './types'
import { getMonthsUpToNow } from './finance-utils'

export async function generateMissingMonths(
  schoolYear: SchoolYear,
  students: Student[],
  fees: Fee[],
  db: Firestore,
  userId: string,
): Promise<number> {
  const months = getMonthsUpToNow(schoolYear)
  if (months.length === 0) return 0

  let generated = 0
  const activeStudents = students.filter((s) => s.isActive)
  if (activeStudents.length === 0) return 0

  for (const { month, year } of months) {
    // Find which students already have an entry for this month
    const snap = await getDocs(
      query(
        collection(db, 'monthlyEntries'),
        where('schoolYearId', '==', schoolYear.id),
        where('userId', '==', userId),
        where('month', '==', month),
        where('year', '==', year),
      ),
    )
    const existingStudentIds = new Set(snap.docs.map((d) => d.data().studentId as string))
    const missing = activeStudents.filter((s) => !existingStudentIds.has(s.id))
    if (missing.length === 0) continue

    await Promise.all(
      missing.map((student) => {
        const entryFees: MonthlyEntryFee[] = []
        let totalDue = 0

        for (const af of student.appliedFees) {
          const fee = fees.find((f) => f.id === af.feeId)
          if (!fee) continue
          const due = Math.max(0, fee.monthlyAmount - af.reduction)
          entryFees.push({
            feeId: fee.id,
            feeName: fee.name,
            amount: fee.monthlyAmount,
            reduction: af.reduction,
            due,
            paid: 0,
            balance: due,
          })
          totalDue += due
        }

        return addDoc(collection(db, 'monthlyEntries'), {
          studentId: student.id,
          schoolYearId: schoolYear.id,
          userId,
          month,
          year,
          isActive: true,
          fees: entryFees,
          totalDue,
          totalPaid: 0,
          totalBalance: totalDue,
          generatedAt: new Date().toISOString(),
        })
      }),
    )

    generated += missing.length
  }

  return generated
}
