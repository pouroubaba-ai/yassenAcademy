import { Composition, SchoolClass, Subject, Student, Grade } from './types'
import { calcGeneralAverage, getMention, normalizeToTwenty, fmt2 } from './grade-utils'
import { generateAppreciation } from './appreciation-generator'

export interface BulletinInput {
  composition: Composition
  classInfo: SchoolClass
  students: Student[]
  subjects: Subject[]
  grades: Grade[]
  allCompositions: Composition[]  // pour la tendance
  allGrades: Grade[]              // pour la tendance
  schoolName: string
  schoolAddress?: string
  schoolPhone?: string
  schoolEmail?: string
  schoolYearLabel?: string
}

function mentionColor(norm20: number): [number, number, number] {
  if (norm20 >= 16) return [21, 128, 61]
  if (norm20 >= 14) return [22, 163, 74]
  if (norm20 >= 12) return [37, 99, 235]
  if (norm20 >= 10) return [180, 83, 9]
  return [185, 28, 28]
}

function mentionFill(norm20: number): [number, number, number] {
  if (norm20 >= 16) return [220, 252, 231]
  if (norm20 >= 14) return [240, 253, 244]
  if (norm20 >= 12) return [219, 234, 254]
  if (norm20 >= 10) return [254, 243, 199]
  return [254, 226, 226]
}

export async function generateClassBulletins(input: BulletinInput) {
  const { default: jsPDF } = await import('jspdf')

  const {
    composition, classInfo, students, subjects, grades,
    allCompositions, allGrades,
    schoolName, schoolAddress, schoolPhone, schoolEmail, schoolYearLabel,
  } = input

  const classId = classInfo.id
  const maxGrade = composition.maxGrade ?? 20
  const subjectIds = Object.keys(composition.coefficients[classId] ?? {})
  const classSubjects = subjects.filter(s => subjectIds.includes(s.id))
  const coeffs = composition.coefficients[classId] ?? {}

  // Excluded students
  const excluded = composition.excludedStudents?.[classId] ?? []
  const activeStudents = students.filter(s => !excluded.includes(s.id))

  // Per-student general averages for ranking
  const genAvgMap: Record<string, number | null> = {}
  for (const student of activeStudents) {
    const sg = grades.filter(g => g.studentId === student.id && g.classId === classId && g.compositionId === composition.id)
    genAvgMap[student.id] = calcGeneralAverage(sg.map(g => ({ average: g.average, subjectId: g.subjectId })), coeffs)
  }

  const completedStudents = activeStudents.filter(s => genAvgMap[s.id] !== null)
  if (completedStudents.length === 0) {
    alert('Aucun élève avec toutes les notes saisies.')
    return
  }

  const sortedAvgs = [...completedStudents.map(s => genAvgMap[s.id] as number)].sort((a, b) => b - a)
  const classGradeAvgs = completedStudents.map(s => genAvgMap[s.id] as number)
  const classGeneralAvg = classGradeAvgs.reduce((s, a) => s + a, 0) / classGradeAvgs.length
  const classHighest = Math.max(...classGradeAvgs)
  const classLowest = Math.min(...classGradeAvgs)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 14, CW = W - M * 2

  completedStudents.forEach((student, idx) => {
    if (idx > 0) pdf.addPage()

    const genAvg = genAvgMap[student.id]!
    const norm = normalizeToTwenty(genAvg, maxGrade)
    const rank = sortedAvgs.indexOf(genAvg) + 1
    const total = completedStudents.length
    const studentGrades = grades.filter(g => g.studentId === student.id && g.classId === classId && g.compositionId === composition.id)

    // ── HEADER ──────────────────────────────────────────────────────────
    pdf.setFillColor(15, 23, 42)
    pdf.rect(0, 0, W, 40, 'F')
    pdf.setFillColor(0, 209, 255)
    pdf.rect(0, 0, 4, 40, 'F')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.setTextColor(255, 255, 255)
    pdf.text(schoolName || 'Établissement Scolaire', M + 2, 13)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    const details = [schoolAddress, [schoolPhone, schoolEmail].filter(Boolean).join('  ·  ')].filter(Boolean) as string[]
    details.forEach((line, li) => pdf.text(line, M + 2, 19 + li * 5))

    // Right badge
    pdf.setFillColor(0, 209, 255)
    pdf.roundedRect(W - M - 52, 6, 52, 28, 3, 3, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.setTextColor(15, 23, 42)
    pdf.text('BULLETIN DE NOTES', W - M - 26, 16, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    const compLabel = composition.name.length > 22 ? composition.name.slice(0, 20) + '…' : composition.name
    pdf.text(compLabel, W - M - 26, 22.5, { align: 'center' })
    if (schoolYearLabel) pdf.text(`Année ${schoolYearLabel}`, W - M - 26, 29, { align: 'center' })

    let y = 40

    // ── STUDENT INFO BAR ─────────────────────────────────────────────────
    pdf.setFillColor(241, 245, 249)
    pdf.rect(0, y, W, 20, 'F')
    pdf.setDrawColor(203, 213, 225)
    pdf.line(0, y, W, y)
    pdf.line(0, y + 20, W, y + 20)
    pdf.line(W / 2 + 5, y + 3, W / 2 + 5, y + 17)

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.setTextColor(15, 23, 42)
    pdf.text(`${student.lastName.toUpperCase()} ${student.firstName}`, M + 2, y + 8)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(71, 85, 105)
    pdf.text(`Classe : ${classInfo.name}  ·  Base de notation : /${maxGrade}`, M + 2, y + 14.5)

    // Rank
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(20)
    pdf.setTextColor(0, 150, 185)
    pdf.text(`${rank}`, W / 2 + 18, y + 12)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(100, 116, 139)
    pdf.text(`/ ${total} élèves`, W / 2 + 24, y + 17.5)
    pdf.text('RANG', W / 2 + 18, y + 5)

    // General avg
    const [cr, cg2, cb] = mentionColor(norm)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(20)
    pdf.setTextColor(cr, cg2, cb)
    pdf.text(fmt2(genAvg), W - M - 2, y + 12, { align: 'right' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(100, 116, 139)
    pdf.text('MOY. GÉN.', W - M - 2, y + 5, { align: 'right' })
    pdf.text(`/ ${maxGrade}  ·  ${getMention(genAvg, maxGrade)}`, W - M - 2, y + 17.5, { align: 'right' })

    y += 20

    // ── GRADES TABLE ─────────────────────────────────────────────────────
    y += 5
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(100, 116, 139)
    pdf.text('RÉSULTATS PAR MATIÈRE', M, y)
    y += 4

    // Column widths (adaptive to noteCount)
    const noteColW = Math.max(14, Math.min(20, (CW - 60 - 20 - 14 - 18 - 32) / Math.max(composition.noteCount, 1)))
    const subjectColW = 54
    const avgColW = 20
    const coeffColW = 14
    const pondColW = 18
    const mentionColW = CW - subjectColW - noteColW * composition.noteCount - avgColW - coeffColW - pondColW

    const col = {
      subject: M + 3,
      note: (i: number) => M + subjectColW + i * noteColW + noteColW / 2,
      avg: M + subjectColW + noteColW * composition.noteCount + avgColW / 2,
      coeff: M + subjectColW + noteColW * composition.noteCount + avgColW + coeffColW / 2,
      pond: M + subjectColW + noteColW * composition.noteCount + avgColW + coeffColW + pondColW / 2,
      mention: M + subjectColW + noteColW * composition.noteCount + avgColW + coeffColW + pondColW + 3,
    }

    pdf.setFillColor(30, 41, 59)
    pdf.rect(M, y, CW, 8, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.setTextColor(255, 255, 255)
    pdf.text('MATIÈRE', col.subject, y + 5.3)
    for (let i = 0; i < composition.noteCount; i++) {
      pdf.text((composition.noteNames[i] ?? `N${i+1}`).slice(0, 7).toUpperCase(), col.note(i), y + 5.3, { align: 'center' })
    }
    pdf.text(`MOY./${maxGrade}`, col.avg, y + 5.3, { align: 'center' })
    pdf.text('COEF.', col.coeff, y + 5.3, { align: 'center' })
    pdf.text('POND.', col.pond, y + 5.3, { align: 'center' })
    pdf.text('APPRÉCIATION', col.mention, y + 5.3)
    y += 8

    let totalWeighted = 0, totalCoeff = 0

    for (let ri = 0; ri < classSubjects.length; ri++) {
      const sub = classSubjects[ri]
      const coeff = coeffs[sub.id] ?? 1
      const grade = studentGrades.find(g => g.subjectId === sub.id)
      const avg = grade?.average ?? null
      const weighted = avg !== null ? avg * coeff : null
      const subNorm = avg !== null ? normalizeToTwenty(avg, maxGrade) : null

      if (weighted !== null) { totalWeighted += weighted; totalCoeff += coeff }

      const ROW_H = 7

      if (ri % 2 === 0) { pdf.setFillColor(248, 250, 252) } else { pdf.setFillColor(255, 255, 255) }
      pdf.rect(M, y, CW, ROW_H, 'F')

      // Color bar
      if (subNorm !== null) {
        const [lr, lg, lb] = mentionColor(subNorm)
        pdf.setFillColor(lr, lg, lb)
      } else {
        pdf.setFillColor(203, 213, 225)
      }
      pdf.rect(M, y, 3, ROW_H, 'F')

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(30, 41, 59)
      pdf.text((sub.name.length > 22 ? sub.name.slice(0, 20) + '…' : sub.name), col.subject, y + 4.8)

      for (let ni = 0; ni < composition.noteCount; ni++) {
        const n = grade?.notes[ni] ?? null
        pdf.setTextColor(n !== null ? 51 : 180, 65, n !== null ? 85 : 180)
        pdf.text(n !== null ? String(n) : '—', col.note(ni), y + 4.8, { align: 'center' })
      }

      if (avg !== null && subNorm !== null) {
        const [ac, ag2, ab2] = mentionColor(subNorm)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7.5)
        pdf.setTextColor(ac, ag2, ab2)
        pdf.text(fmt2(avg), col.avg, y + 4.8, { align: 'center' })
      } else {
        pdf.setTextColor(180, 180, 180)
        pdf.setFont('helvetica', 'normal')
        pdf.text('—', col.avg, y + 4.8, { align: 'center' })
      }

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.setTextColor(100, 116, 139)
      pdf.text(String(coeff), col.coeff, y + 4.8, { align: 'center' })
      pdf.setTextColor(30, 41, 59)
      pdf.text(weighted !== null ? fmt2(weighted) : '—', col.pond, y + 4.8, { align: 'center' })

      if (avg !== null && subNorm !== null) {
        const mention = getMention(avg, maxGrade)
        const [mr, mg, mb] = mentionColor(subNorm)
        const [fr, fg, fb] = mentionFill(subNorm)
        pdf.setFillColor(fr, fg, fb)
        pdf.roundedRect(col.mention, y + 1.2, Math.min(mentionColW - 4, mention.length * 2.1 + 4), 5, 1, 1, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(6)
        pdf.setTextColor(mr, mg, mb)
        pdf.text(mention.toUpperCase(), col.mention + 2, y + 4.8)
      }

      pdf.setDrawColor(226, 232, 240)
      pdf.setLineWidth(0.2)
      pdf.line(M, y + ROW_H, M + CW, y + ROW_H)
      y += ROW_H
    }

    y += 5

    // ── SUMMARY BOX ───────────────────────────────────────────────────────
    const summaryH = 22
    pdf.setFillColor(15, 23, 42)
    pdf.roundedRect(M, y, CW, summaryH, 3, 3, 'F')

    // Average block
    const [sar, sag, sab] = mentionColor(norm)
    pdf.setFillColor(sar, sag, sab)
    pdf.roundedRect(M + 4, y + 3, 38, 16, 2, 2, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(255, 255, 255)
    pdf.text(fmt2(genAvg), M + 23, y + 13, { align: 'center' })
    pdf.setFontSize(6.5)
    pdf.text(`/ ${maxGrade}`, M + 23, y + 18, { align: 'center' })

    pdf.setFontSize(11)
    pdf.setTextColor(255, 255, 255)
    pdf.text(getMention(genAvg, maxGrade), M + 48, y + 12)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text('Moyenne générale', M + 48, y + 18.5)

    // Divider
    pdf.setDrawColor(51, 65, 85)
    pdf.line(W / 2 + 8, y + 4, W / 2 + 8, y + summaryH - 4)

    // Class stats
    const sx = W / 2 + 14
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(148, 163, 184)
    pdf.text('Statistiques de classe', sx, y + 7)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(255, 255, 255)
    pdf.text(`Moy. : ${fmt2(classGeneralAvg)}  ·  Max : ${fmt2(classHighest)}  ·  Min : ${fmt2(classLowest)}`, sx, y + 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(148, 163, 184)
    pdf.text(`Base /${maxGrade}  ·  ${completedStudents.length} élève${completedStudents.length > 1 ? 's' : ''} classé${completedStudents.length > 1 ? 's' : ''}`, sx, y + 18.5)

    // Rank badge
    pdf.setFillColor(0, 209, 255)
    pdf.roundedRect(W - M - 24, y + 4, 20, 14, 2, 2, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.setTextColor(15, 23, 42)
    pdf.text(`${rank}`, W - M - 14, y + 13.5, { align: 'center' })
    pdf.setFontSize(6)
    pdf.text(`/ ${total}`, W - M - 14, y + 17.5, { align: 'center' })
    pdf.text('RANG', W - M - 14, y + 7, { align: 'center' })

    y += summaryH + 5

    // ── AUTO APPRECIATION ─────────────────────────────────────────────────
    const appreciationText = generateAppreciation({
      student,
      composition,
      classId,
      subjects,
      studentGrades,
      allCompositions,
      allStudentGrades: allGrades.filter(g => g.studentId === student.id),
      generalAvg: genAvg,
      rank,
      totalStudents: total,
      classAvg: classGeneralAvg,
    })

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(100, 116, 139)
    pdf.text('APPRÉCIATION', M, y)
    y += 4

    const appreciationH = 32
    pdf.setFillColor(250, 252, 255)
    pdf.setDrawColor(203, 213, 225)
    pdf.roundedRect(M, y, CW, appreciationH, 2, 2, 'FD')

    // Left accent bar
    const [acr, acg, acb] = mentionColor(norm)
    pdf.setFillColor(acr, acg, acb)
    pdf.roundedRect(M, y, 3, appreciationH, 1, 1, 'F')

    // Appreciation text (wrapped)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(30, 41, 59)
    const lines = pdf.splitTextToSize(appreciationText, CW - 12)
    const maxLines = Math.floor((appreciationH - 6) / 5.5)
    lines.slice(0, maxLines).forEach((line: string, li: number) => {
      pdf.text(line, M + 6, y + 7 + li * 5.5)
    })

    y += appreciationH + 5

    // ── SIGNATURES ───────────────────────────────────────────────────────
    const remainingH = H - 12 - y
    if (remainingH >= 22) {
      const sigW = (CW - 10) / 3
      const sigLabels = ['Cachet & Signature\nde l\'établissement', 'Signature\ndu directeur', 'Signature\ndu parent / tuteur']
      sigLabels.forEach((label, si) => {
        const sx2 = M + si * (sigW + 5)
        pdf.setFillColor(248, 250, 252)
        pdf.setDrawColor(203, 213, 225)
        pdf.roundedRect(sx2, y, sigW, 20, 2, 2, 'FD')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(6.5)
        pdf.setTextColor(100, 116, 139)
        label.split('\n').forEach((line, li) => {
          pdf.text(line, sx2 + sigW / 2, y + 5 + li * 4.5, { align: 'center' })
        })
      })
    }

    // ── FOOTER ────────────────────────────────────────────────────────────
    pdf.setDrawColor(226, 232, 240)
    pdf.line(M, H - 10, W - M, H - 10)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6)
    pdf.setTextColor(148, 163, 184)
    pdf.text(schoolName, M, H - 5.5)
    pdf.text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`, W - M, H - 5.5, { align: 'right' })
    if (schoolEmail) pdf.text(schoolEmail, W / 2, H - 5.5, { align: 'center' })
  })

  pdf.save(`Bulletins_${composition.name}_${classInfo.name}.pdf`)
}
