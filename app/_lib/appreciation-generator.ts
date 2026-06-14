import { Composition, Grade, Student, Subject } from './types'
import { calcGeneralAverage, normalizeToTwenty, fmt2 } from './grade-utils'

export interface AppreciationParams {
  student: Student
  composition: Composition
  classId: string
  subjects: Subject[]
  studentGrades: Grade[]         // grades de cet élève pour cette composition
  allCompositions: Composition[] // toutes les compositions de l'année (ordre chronologique)
  allStudentGrades: Grade[]      // toutes les notes de cet élève (toutes compositions)
  generalAvg: number | null
  rank: number | null
  totalStudents: number
  classAvg: number | null
}

export function generateAppreciation(p: AppreciationParams): string {
  const {
    student, composition, classId, subjects, studentGrades,
    allCompositions, allStudentGrades,
    generalAvg, rank, totalStudents, classAvg,
  } = p

  if (generalAvg === null) return ''

  const maxGrade = composition.maxGrade ?? 20
  const norm = normalizeToTwenty(generalAvg, maxGrade)
  const prenom = student.firstName
  const f = student.gender === 'F'
  const il = f ? 'elle' : 'il'
  const Il = f ? 'Elle' : 'Il'
  const e = f ? 'e' : ''
  const coeffs = composition.coefficients[classId] ?? {}
  const subjectIds = Object.keys(coeffs)
  const classSubjects = subjects.filter(s => subjectIds.includes(s.id))

  // ── Per-subject performance ──────────────────────────────────────────
  interface SubPerf { name: string; avg: number; norm: number; coeff: number }
  const subPerfs: SubPerf[] = classSubjects.map(sub => {
    const g = studentGrades.find(gr => gr.subjectId === sub.id && gr.classId === classId)
    const avg = g?.average ?? null
    if (avg === null) return null
    return { name: sub.name, avg, norm: normalizeToTwenty(avg, maxGrade), coeff: coeffs[sub.id] ?? 1 }
  }).filter((x): x is SubPerf => x !== null)

  const excellent = subPerfs.filter(s => s.norm >= 16).sort((a, b) => b.norm - a.norm)
  const good      = subPerfs.filter(s => s.norm >= 14 && s.norm < 16).sort((a, b) => b.norm - a.norm)
  const average   = subPerfs.filter(s => s.norm >= 10 && s.norm < 14)
  const weak      = subPerfs.filter(s => s.norm >= 7 && s.norm < 10).sort((a, b) => a.norm - b.norm)
  const failing   = subPerfs.filter(s => s.norm < 7).sort((a, b) => a.norm - b.norm)
  const strengths = [...excellent, ...good].slice(0, 3)
  const concerns  = [...failing, ...weak].slice(0, 3)

  // ── Trend vs previous compositions ──────────────────────────────────
  const prevComps = allCompositions
    .filter(c => c.id !== composition.id
      && c.classIds.includes(classId)
      && c.createdAt < composition.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  let trendText = ''
  let prevNorm: number | null = null
  if (prevComps.length > 0) {
    const last = prevComps[0]
    const lastMax = last.maxGrade ?? 20
    const lastGrades = allStudentGrades.filter(g => g.studentId === student.id && g.compositionId === last.id && g.classId === classId)
    const lastAvg = calcGeneralAverage(lastGrades.map(g => ({ average: g.average, subjectId: g.subjectId })), last.coefficients[classId] ?? {})
    if (lastAvg !== null) {
      prevNorm = normalizeToTwenty(lastAvg, lastMax)
      const diff = norm - prevNorm
      if (diff >= 2)         trendText = `En nette progression par rapport à ${last.name} (+${fmt2(diff)} pts)`
      else if (diff >= 0.75) trendText = `En légère progression par rapport à ${last.name} (+${fmt2(diff)} pts)`
      else if (diff <= -2)   trendText = `En baisse notable par rapport à ${last.name} (${fmt2(diff)} pts)`
      else if (diff <= -0.75) trendText = `En légère baisse par rapport à ${last.name} (${fmt2(diff)} pts)`
      else                   trendText = `Résultats stables par rapport à ${last.name}`
    }
  }

  // ── Evolution over multiple compositions ─────────────────────────────
  // Are we improving globally over all previous comps?
  let globalTrend = ''
  if (prevComps.length >= 2) {
    const allPrevNorms: number[] = []
    for (const pc of prevComps.slice(0, 3).reverse()) {
      const pcMax = pc.maxGrade ?? 20
      const pcGrades = allStudentGrades.filter(g => g.studentId === student.id && g.compositionId === pc.id && g.classId === classId)
      const pcAvg = calcGeneralAverage(pcGrades.map(g => ({ average: g.average, subjectId: g.subjectId })), pc.coefficients[classId] ?? {})
      if (pcAvg !== null) allPrevNorms.push(normalizeToTwenty(pcAvg, pcMax))
    }
    if (allPrevNorms.length >= 2) {
      const firstOld = allPrevNorms[0]
      const lastOld = allPrevNorms[allPrevNorms.length - 1]
      const overall = norm - firstOld
      if (overall >= 2 && norm > lastOld) globalTrend = `Sa trajectoire est régulièrement ascendante depuis le début de l'année.`
      else if (overall <= -2 && norm < lastOld) globalTrend = `Sa trajectoire globale sur l'année est préoccupante.`
    }
  }

  // ── Build sentences ───────────────────────────────────────────────────
  const sentences: string[] = []

  // 1. Opening — general result
  const rankText = rank !== null
    ? `, classé${e} ${rank}${rank === 1 ? 'er' : 'ème'}${rank === 1 ? (f ? 'ère' : '') : ''} sur ${totalStudents} élèves`
    : ''
  const vsClassText = classAvg !== null
    ? ` (moyenne de classe : ${fmt2(normalizeToTwenty(classAvg, maxGrade))}/20)`
    : ''

  if (norm >= 17)
    sentences.push(`${prenom} réalise une performance remarquable lors de ${composition.name}, avec une moyenne générale de ${fmt2(generalAvg)}/${maxGrade}${rankText}.${vsClassText}`)
  else if (norm >= 15)
    sentences.push(`${prenom} obtient de très bons résultats lors de ${composition.name} avec ${fmt2(generalAvg)}/${maxGrade}${rankText}.${vsClassText}`)
  else if (norm >= 13)
    sentences.push(`${prenom} affiche de bons résultats lors de ${composition.name}, avec une moyenne de ${fmt2(generalAvg)}/${maxGrade}${rankText}.${vsClassText}`)
  else if (norm >= 11)
    sentences.push(`${prenom} obtient des résultats satisfaisants lors de ${composition.name} (${fmt2(generalAvg)}/${maxGrade}${rankText}).${vsClassText}`)
  else if (norm >= 9)
    sentences.push(`Les résultats de ${prenom} lors de ${composition.name} sont moyens : ${fmt2(generalAvg)}/${maxGrade}${rankText}.${vsClassText}`)
  else
    sentences.push(`Les résultats de ${prenom} lors de ${composition.name} sont insuffisants (${fmt2(generalAvg)}/${maxGrade}${rankText}) et nécessitent une attention particulière.${vsClassText}`)

  // 2. Strengths
  if (strengths.length > 0) {
    const top = strengths.slice(0, 3)
    if (top.length === 1) {
      sentences.push(`${Il} se distingue particulièrement en ${top[0].name}, avec une note de ${fmt2(top[0].avg)}/${maxGrade}.`)
    } else {
      const list = top.map(s => `${s.name} (${fmt2(s.avg)}/${maxGrade})`).join(', ')
      sentences.push(`${Il} se distingue en ${list}.`)
    }
  }

  // 3. Average subjects — brief note if above class average in several
  const aboveClass = classAvg !== null
    ? subPerfs.filter(s => s.avg > classAvg && !strengths.find(st => st.name === s.name))
    : []
  if (aboveClass.length >= 2 && strengths.length === 0) {
    const names = aboveClass.slice(0, 2).map(s => s.name).join(' et ')
    sentences.push(`${Il} affiche de bonnes performances en ${names}, au-dessus de la moyenne de classe.`)
  }

  // 4. Concerns / weaknesses
  if (failing.length > 0) {
    const list = failing.slice(0, 3).map(s => `${s.name} (${fmt2(s.avg)}/${maxGrade})`).join(', ')
    sentences.push(`Des lacunes importantes sont à combler en ${list} : un travail régulier et un soutien supplémentaire sont fortement recommandés.`)
  } else if (weak.length > 0) {
    const list = weak.slice(0, 3).map(s => `${s.name} (${fmt2(s.avg)}/${maxGrade})`).join(', ')
    sentences.push(`Des efforts supplémentaires sont attendus en ${list} pour élever le niveau global.`)
  }

  // 5. Trend vs previous composition
  if (trendText) {
    sentences.push(`${trendText}.`)
  }
  if (globalTrend) {
    sentences.push(globalTrend)
  }

  // 6. Closing encouragement / message to parents
  if (norm >= 16) {
    sentences.push(`Nous félicitons chaleureusement ${prenom} pour cette excellente performance et l'encourageons à maintenir cet exemplaire niveau de travail.`)
  } else if (norm >= 14) {
    sentences.push(`Nous félicitons ${prenom} pour ce bon travail et l'encourageons à continuer dans cette voie.`)
  } else if (norm >= 12) {
    sentences.push(`Nous encourageons ${prenom} à persévérer afin de consolider et d'améliorer ses acquis.`)
  } else if (norm >= 10) {
    sentences.push(`Nous invitons ${prenom} et sa famille à redoubler d'efforts pour atteindre un niveau plus solide.`)
  } else {
    sentences.push(`Nous invitons la famille à se rapprocher de l'établissement pour envisager un accompagnement adapté à la situation de ${prenom}.`)
  }

  return sentences.join(' ')
}
