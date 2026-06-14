import { Composition, SchoolClass, Subject, Student, Grade, SchoolYear } from './types'
import { calcGeneralAverage, calcAnnualAverage, getMention, fmt2 } from './grade-utils'

export interface AnnualBulletinInput {
  classes: SchoolClass[]
  students: Student[]
  compositions: Composition[]
  subjects: Subject[]
  grades: Grade[]
  schoolName: string
  schoolAddress?: string
  schoolPhone?: string
  schoolEmail?: string
  schoolYear: SchoolYear
}

function mentionColor(avg: number): [number, number, number] {
  if (avg >= 16) return [21, 128, 61]
  if (avg >= 14) return [22, 163, 74]
  if (avg >= 12) return [37, 99, 235]
  if (avg >= 10) return [180, 83, 9]
  return [185, 28, 28]
}

function mentionFill(avg: number): [number, number, number] {
  if (avg >= 16) return [220, 252, 231]
  if (avg >= 14) return [240, 253, 244]
  if (avg >= 12) return [219, 234, 254]
  if (avg >= 10) return [254, 243, 199]
  return [254, 226, 226]
}

export async function generateAnnualBulletins(input: AnnualBulletinInput) {
  const { default: jsPDF } = await import('jspdf')
  const { students, compositions, subjects, grades, schoolName, schoolAddress, schoolPhone, schoolEmail, schoolYear, classes } = input

  if (students.length === 0 || compositions.length === 0) {
    alert('Aucune donnée disponible.')
    return
  }

  const classId = students[0]?.classId
  const classInfo = classes[0]
  if (!classId || !classInfo) return

  const yearLabel = `${schoolYear.startYear}/${schoolYear.endYear}`

  // Per-student stats
  const statsMap: Record<string, { compAvgs: (number | null)[]; annualAvg: number | null; subjectAnnualAvgs: Record<string, number | null> }> = {}

  const allSubjectIds = new Set<string>()
  for (const comp of compositions) {
    for (const sid of Object.keys(comp.coefficients[classId] ?? {})) allSubjectIds.add(sid)
  }
  const displaySubjects = subjects.filter(s => allSubjectIds.has(s.id))

  for (const student of students) {
    const compAvgs = compositions.map(comp => {
      const coeffs = comp.coefficients[classId] ?? {}
      const sg = grades.filter(g => g.studentId === student.id && g.compositionId === comp.id && g.classId === classId)
      return calcGeneralAverage(sg.map(g => ({ average: g.average, subjectId: g.subjectId })), coeffs)
    })
    const annualAvg = calcAnnualAverage(compAvgs)
    const subjectAnnualAvgs: Record<string, number | null> = {}
    for (const sub of displaySubjects) {
      const compSubAvgs = compositions.map(comp => {
        const g = grades.find(gr => gr.studentId === student.id && gr.compositionId === comp.id && gr.classId === classId && gr.subjectId === sub.id)
        return g?.average ?? null
      })
      subjectAnnualAvgs[sub.id] = calcAnnualAverage(compSubAvgs)
    }
    statsMap[student.id] = { compAvgs, annualAvg, subjectAnnualAvgs }
  }

  const completedStudents = students.filter(s => statsMap[s.id].annualAvg !== null)
  if (completedStudents.length === 0) {
    alert('Aucun élève avec toutes les moyennes calculées.')
    return
  }

  const sortedAvgs = completedStudents.map(s => statsMap[s.id].annualAvg as number).sort((a, b) => b - a)
  const allAnnualAvgs = completedStudents.map(s => statsMap[s.id].annualAvg as number)
  const classAvg = allAnnualAvgs.reduce((s, a) => s + a, 0) / allAnnualAvgs.length
  const classHighest = Math.max(...allAnnualAvgs)
  const classLowest = Math.min(...allAnnualAvgs)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const H = 297
  const M = 14
  const CW = W - M * 2

  completedStudents.forEach((student, idx) => {
    if (idx > 0) pdf.addPage()

    const stats = statsMap[student.id]
    const annualAvg = stats.annualAvg!
    const rank = sortedAvgs.indexOf(annualAvg) + 1
    const total = completedStudents.length

    // ── HEADER ──────────────────────────────────────────────────────────
    pdf.setFillColor(15, 23, 42)
    pdf.rect(0, 0, W, 42, 'F')
    pdf.setFillColor(0, 209, 255)
    pdf.rect(0, 0, 4, 42, 'F')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.setTextColor(255, 255, 255)
    pdf.text(schoolName || 'Établissement Scolaire', M + 2, 14)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(148, 163, 184)
    const details = [schoolAddress, [schoolPhone, schoolEmail].filter(Boolean).join('  ·  ')].filter(Boolean) as string[]
    details.forEach((line, li) => pdf.text(line, M + 2, 21 + li * 5.5))

    pdf.setFillColor(0, 209, 255)
    pdf.roundedRect(W - M - 54, 7, 54, 28, 3, 3, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(15, 23, 42)
    pdf.text('BULLETIN ANNUEL', W - M - 27, 17, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text(`Année ${yearLabel}`, W - M - 27, 24, { align: 'center' })
    pdf.text(`${classInfo.name}`, W - M - 27, 31, { align: 'center' })

    let y = 42

    // ── STUDENT INFO BAR ─────────────────────────────────────────────────
    pdf.setFillColor(241, 245, 249)
    pdf.rect(0, y, W, 22, 'F')
    pdf.setDrawColor(203, 213, 225)
    pdf.line(0, y, W, y)
    pdf.line(0, y + 22, W, y + 22)
    pdf.line(W / 2, y + 3, W / 2, y + 19)

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.setTextColor(15, 23, 42)
    pdf.text(`${student.lastName.toUpperCase()} ${student.firstName}`, M + 2, y + 8.5)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(71, 85, 105)
    pdf.text(`Classe : ${classInfo.name}  ·  Année scolaire ${yearLabel}`, M + 2, y + 15)

    // Rank + avg right
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(22)
    pdf.setTextColor(0, 150, 185)
    pdf.text(`${rank}`, W / 2 + 12, y + 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    pdf.text(`/ ${total} élèves`, W / 2 + 18, y + 19)
    pdf.text('RANG', W / 2 + 12, y + 5)

    const [cr, cg2, cb] = mentionColor(annualAvg)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(22)
    pdf.setTextColor(cr, cg2, cb)
    pdf.text(fmt2(annualAvg), W - M - 2, y + 13, { align: 'right' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    pdf.text('MOY. ANNUELLE', W - M - 2, y + 5, { align: 'right' })
    pdf.text(`/ 20 · ${getMention(annualAvg)}`, W - M - 2, y + 19, { align: 'right' })

    y += 22

    // ── PER-COMPOSITION SUMMARY TABLE ────────────────────────────────────
    y += 6
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    pdf.text('MOYENNES PAR COMPOSITION', M, y)
    y += 4

    const compColW = Math.min(40, (CW - 4) / compositions.length)
    pdf.setFillColor(30, 41, 59)
    pdf.rect(M, y, CW, 8, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(255, 255, 255)
    compositions.forEach((comp, ci) => {
      const cx = M + ci * compColW + compColW / 2
      const label = comp.name.length > 14 ? comp.name.slice(0, 12) + '…' : comp.name
      pdf.text(label.toUpperCase(), cx, y + 5.3, { align: 'center' })
    })
    pdf.text('RANG', M + CW - 20, y + 5.3, { align: 'center' })
    y += 8

    pdf.setFillColor(248, 250, 252)
    pdf.rect(M, y, CW, 10, 'F')
    pdf.setDrawColor(226, 232, 240)
    pdf.line(M, y + 10, M + CW, y + 10)

    stats.compAvgs.forEach((avg, ci) => {
      const cx = M + ci * compColW + compColW / 2
      if (avg !== null) {
        const [ar, ag, ab] = mentionColor(avg)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.setTextColor(ar, ag, ab)
        pdf.text(fmt2(avg), cx, y + 6.5, { align: 'center' })
      } else {
        pdf.setTextColor(180, 180, 180)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.text('—', cx, y + 6.5, { align: 'center' })
      }
    })
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    const [rr, rg, rb] = mentionColor(annualAvg)
    pdf.setTextColor(rr, rg, rb)
    pdf.text(`${rank} / ${total}`, M + CW - 20, y + 6.5, { align: 'center' })
    y += 10

    // ── SUBJECT DETAILS TABLE ─────────────────────────────────────────────
    y += 6
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    pdf.text('DÉTAIL PAR MATIÈRE', M, y)
    y += 4

    const compDetailColW = Math.min(22, (CW - 58 - 24) / Math.max(compositions.length, 1))
    const subjectDetailW = 54

    pdf.setFillColor(30, 41, 59)
    pdf.rect(M, y, CW, 8, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(255, 255, 255)
    pdf.text('MATIÈRE', M + 3, y + 5.3)
    compositions.forEach((comp, ci) => {
      const cx = M + subjectDetailW + ci * compDetailColW + compDetailColW / 2
      const label = comp.name.length > 8 ? comp.name.slice(0, 6) + '…' : comp.name
      pdf.text(label.toUpperCase(), cx, y + 5.3, { align: 'center' })
    })
    const annColX = M + subjectDetailW + compositions.length * compDetailColW + 12
    pdf.text('MOY. ANN.', annColX, y + 5.3, { align: 'center' })
    pdf.text('APPRÉCIATION', annColX + 24, y + 5.3)
    y += 8

    displaySubjects.forEach((sub, ri) => {
      const ROW_H = 7
      if (ri % 2 === 0) {
        pdf.setFillColor(248, 250, 252)
      } else {
        pdf.setFillColor(255, 255, 255)
      }
      pdf.rect(M, y, CW, ROW_H, 'F')

      const subAnnAvg = stats.subjectAnnualAvgs[sub.id]
      if (subAnnAvg !== null && subAnnAvg !== undefined) {
        const [lr, lg, lb] = mentionColor(subAnnAvg)
        pdf.setFillColor(lr, lg, lb)
        pdf.rect(M, y, 3, ROW_H, 'F')
      } else {
        pdf.setFillColor(203, 213, 225)
        pdf.rect(M, y, 3, ROW_H, 'F')
      }

      const subName = sub.name.length > 20 ? sub.name.slice(0, 19) + '…' : sub.name
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(30, 41, 59)
      pdf.text(subName, M + 4, y + 4.8)

      compositions.forEach((comp, ci) => {
        const cx = M + subjectDetailW + ci * compDetailColW + compDetailColW / 2
        const g = grades.find(gr => gr.studentId === student.id && gr.compositionId === comp.id && gr.classId === classId && gr.subjectId === sub.id)
        const a = g?.average ?? null
        if (a !== null) {
          const [ac, ag2, ab2] = mentionColor(a)
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(7.5)
          pdf.setTextColor(ac, ag2, ab2)
          pdf.text(fmt2(a), cx, y + 4.8, { align: 'center' })
        } else {
          pdf.setFont('helvetica', 'normal')
          pdf.setTextColor(200, 200, 200)
          pdf.text('—', cx, y + 4.8, { align: 'center' })
        }
      })

      if (subAnnAvg !== null && subAnnAvg !== undefined) {
        const [mc, mg2, mb2] = mentionColor(subAnnAvg)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.setTextColor(mc, mg2, mb2)
        pdf.text(fmt2(subAnnAvg), annColX, y + 4.8, { align: 'center' })

        const mention = getMention(subAnnAvg)
        const [fr, fg, fb] = mentionFill(subAnnAvg)
        pdf.setFillColor(fr, fg, fb)
        pdf.roundedRect(annColX + 14, y + 1.2, mention.length * 2.1 + 4, 5, 1, 1, 'F')
        pdf.setFontSize(6.5)
        pdf.setTextColor(mc, mg2, mb2)
        pdf.text(mention.toUpperCase(), annColX + 16, y + 4.8)
      }

      pdf.setDrawColor(226, 232, 240)
      pdf.setLineWidth(0.2)
      pdf.line(M, y + ROW_H, M + CW, y + ROW_H)
      y += ROW_H
    })

    y += 6

    // ── SUMMARY ───────────────────────────────────────────────────────────
    const summaryH = 24
    pdf.setFillColor(15, 23, 42)
    pdf.roundedRect(M, y, CW, summaryH, 3, 3, 'F')

    const [sar, sag, sab] = mentionColor(annualAvg)
    pdf.setFillColor(sar, sag, sab)
    pdf.roundedRect(M + 4, y + 3, 36, 18, 2, 2, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.setTextColor(255, 255, 255)
    pdf.text(fmt2(annualAvg), M + 22, y + 14, { align: 'center' })
    pdf.setFontSize(7)
    pdf.text('/ 20', M + 22, y + 19, { align: 'center' })

    pdf.setFontSize(11)
    pdf.setTextColor(255, 255, 255)
    pdf.text(getMention(annualAvg), M + 46, y + 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(148, 163, 184)
    pdf.text('Moyenne annuelle', M + 46, y + 20)

    pdf.setDrawColor(51, 65, 85)
    pdf.line(W / 2 + 10, y + 4, W / 2 + 10, y + summaryH - 4)

    const sx2 = W / 2 + 16
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text('Statistiques de classe', sx2, y + 7)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(255, 255, 255)
    pdf.text(`Moy. classe : ${fmt2(classAvg)}/20`, sx2, y + 13.5)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text(`Plus haute : ${fmt2(classHighest)}   Plus basse : ${fmt2(classLowest)}`, sx2, y + 19.5)

    pdf.setFillColor(0, 209, 255)
    pdf.roundedRect(W - M - 26, y + 4, 22, 16, 2, 2, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(15, 23, 42)
    pdf.text(`${rank}`, W - M - 15, y + 14, { align: 'center' })
    pdf.setFontSize(6.5)
    pdf.text(`/ ${total}`, W - M - 15, y + 19, { align: 'center' })
    pdf.text('RANG', W - M - 15, y + 8, { align: 'center' })

    y += summaryH + 6

    // ── APPRECIATION ──────────────────────────────────────────────────────
    const remainingH = H - 12 - 4 - y
    const hasRoomForAppreciation = remainingH >= 50

    if (hasRoomForAppreciation) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
      pdf.setTextColor(100, 116, 139)
      pdf.text('APPRÉCIATION DU DIRECTEUR / DE L\'ENSEIGNANT', M, y)
      y += 5

      const appreciationH = Math.min(28, remainingH - 30)
      pdf.setFillColor(248, 250, 252)
      pdf.setDrawColor(203, 213, 225)
      pdf.roundedRect(M, y, CW, appreciationH, 2, 2, 'FD')
      pdf.setDrawColor(203, 213, 225)
      ;(pdf as any).setLineDash([1, 2])
      const lineCount = Math.floor((appreciationH - 4) / 7)
      for (let li = 0; li < lineCount; li++) {
        pdf.line(M + 4, y + 7 + li * 7, M + CW - 4, y + 7 + li * 7)
      }
      ;(pdf as any).setLineDash([])
      y += appreciationH + 6

      // Signatures
      const sigW = (CW - 10) / 3
      const sigLabels = ['Cachet & Signature\nde l\'établissement', 'Signature\ndu directeur', 'Signature\ndu parent / tuteur']
      sigLabels.forEach((label, si) => {
        const sx3 = M + si * (sigW + 5)
        pdf.setFillColor(248, 250, 252)
        pdf.setDrawColor(203, 213, 225)
        pdf.roundedRect(sx3, y, sigW, 20, 2, 2, 'FD')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(7)
        pdf.setTextColor(100, 116, 139)
        label.split('\n').forEach((line, li) => {
          pdf.text(line, sx3 + sigW / 2, y + 5 + li * 4.5, { align: 'center' })
        })
      })
    }

    // ── FOOTER ────────────────────────────────────────────────────────────
    pdf.setDrawColor(226, 232, 240)
    pdf.line(M, H - 12, W - M, H - 12)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text(schoolName, M, H - 7)
    pdf.text(`Document généré le ${new Date().toLocaleDateString('fr-FR')}`, W - M, H - 7, { align: 'right' })
    if (schoolEmail) pdf.text(schoolEmail, W / 2, H - 7, { align: 'center' })
  })

  pdf.save(`Bulletins_Annuels_${classInfo.name}_${yearLabel}.pdf`)
}
