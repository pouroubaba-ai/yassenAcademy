import { Composition, Grade } from './types'

export function calcSubjectAverage(notes: (number | null)[], noteCount: number): number | null {
  const filled = notes.slice(0, noteCount).filter((n): n is number => n !== null)
  if (filled.length < noteCount) return null
  return filled.reduce((s, n) => s + n, 0) / noteCount
}

export function calcGeneralAverage(
  grades: { average: number | null; subjectId: string }[],
  coefficients: Record<string, number>
): number | null {
  let weighted = 0
  let totalCoeff = 0
  for (const g of grades) {
    if (g.average === null) return null
    const coeff = coefficients[g.subjectId] ?? 1
    weighted += g.average * coeff
    totalCoeff += coeff
  }
  if (totalCoeff === 0) return null
  return weighted / totalCoeff
}

export function calcAnnualAverage(compositionAverages: (number | null)[]): number | null {
  const valid = compositionAverages.filter((a): a is number => a !== null)
  if (valid.length === 0) return null
  return valid.reduce((s, a) => s + a, 0) / valid.length
}

/** Normalize avg to a /20 scale for mention/color decisions */
export function normalizeToTwenty(avg: number, maxGrade: number): number {
  if (maxGrade === 20 || maxGrade === 0) return avg
  return (avg / maxGrade) * 20
}

export function getMention(avg: number, maxGrade = 20): string {
  const n = normalizeToTwenty(avg, maxGrade)
  if (n >= 18) return 'Excellent'
  if (n >= 16) return 'Très Bien'
  if (n >= 14) return 'Bien'
  if (n >= 12) return 'Assez Bien'
  if (n >= 10) return 'Passable'
  return 'Insuffisant'
}

export function getMentionColor(avg: number, maxGrade = 20): string {
  const n = normalizeToTwenty(avg, maxGrade)
  if (n >= 14) return 'text-emerald-600'
  if (n >= 10) return 'text-amber-600'
  return 'text-red-600'
}

export function getMentionBg(avg: number, maxGrade = 20): string {
  const n = normalizeToTwenty(avg, maxGrade)
  if (n >= 14) return 'bg-emerald-50 text-emerald-700'
  if (n >= 10) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

export type CompositionStatus = 'not_started' | 'in_progress' | 'completed'

export function getCompositionStatus(
  composition: Composition,
  grades: Grade[],
  studentsByClass: Record<string, string[]>
): CompositionStatus {
  const compGrades = grades.filter(g => g.compositionId === composition.id)
  if (compGrades.length === 0) return 'not_started'

  let totalExpected = 0
  let totalCompleted = 0

  for (const classId of composition.classIds) {
    const excluded = composition.excludedStudents?.[classId] ?? []
    const students = (studentsByClass[classId] ?? []).filter(id => !excluded.includes(id))
    const subjectIds = Object.keys(composition.coefficients[classId] ?? {})
    for (const studentId of students) {
      for (const subjectId of subjectIds) {
        totalExpected++
        const grade = compGrades.find(
          g => g.studentId === studentId && g.subjectId === subjectId && g.classId === classId
        )
        if (grade && grade.average !== null) totalCompleted++
      }
    }
  }

  if (totalExpected === 0) return 'not_started'
  if (totalCompleted === totalExpected) return 'completed'
  return 'in_progress'
}

export function fmt2(n: number | null): string {
  if (n === null) return '—'
  return n.toFixed(2)
}

export function statusLabel(s: CompositionStatus): string {
  if (s === 'completed') return 'Terminé'
  if (s === 'in_progress') return 'En cours'
  return 'Non commencé'
}

export function statusClass(s: CompositionStatus): string {
  if (s === 'completed') return 'bg-emerald-50 text-emerald-700'
  if (s === 'in_progress') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-500'
}
