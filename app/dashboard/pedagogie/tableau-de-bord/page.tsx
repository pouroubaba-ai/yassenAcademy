'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { Composition, SchoolClass, Subject, Student, Grade } from '../../../_lib/types'
import {
  calcGeneralAverage, calcAnnualAverage, getMention, getMentionBg,
  getCompositionStatus, statusLabel, statusClass, fmt2,
} from '../../../_lib/grade-utils'

export default function PedagogieDashboardPage() {
  const { activeYear, uid } = useSchoolYear()
  const [selectedCompId, setSelectedCompId] = useState<string>('annual')
  const [filterClassId, setFilterClassId] = useState<string>('all')
  const [showAllStudents, setShowAllStudents] = useState(false)

  const [compositions, setCompositions] = useState<Composition[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  useEffect(() => {
    if (!activeYear?.id || !uid) return
    const yid = activeYear.id
    const u1 = onSnapshot(
      query(collection(db, 'compositions'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setCompositions(s.docs.map(d => ({ id: d.id, ...d.data() } as Composition)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    )
    const u2 = onSnapshot(
      query(collection(db, 'classes'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setClasses(s.docs.map(d => ({ id: d.id, ...d.data() } as SchoolClass)))
    )
    const u3 = onSnapshot(query(collection(db, 'subjects'), where('userId', '==', uid)), s =>
      setSubjects(s.docs.map(d => ({ id: d.id, ...d.data() } as Subject)))
    )
    const u4 = onSnapshot(
      query(collection(db, 'students'), where('schoolYearId', '==', yid), where('userId', '==', uid), where('isActive', '==', true)),
      s => setStudents(s.docs.map(d => ({ id: d.id, ...d.data() } as Student)))
    )
    const u5 = onSnapshot(
      query(collection(db, 'grades'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setGrades(s.docs.map(d => ({ id: d.id, ...d.data() } as Grade)))
    )
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [activeYear?.id, uid])

  // Reset "show all" when filter changes
  useEffect(() => { setShowAllStudents(false) }, [filterClassId, selectedCompId])

  const studentsByClass = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const s of students) {
      if (!map[s.classId]) map[s.classId] = []
      map[s.classId].push(s.id)
    }
    return map
  }, [students])

  // Students scoped to the class filter
  const scopedStudents = useMemo(() =>
    filterClassId === 'all' ? students : students.filter(s => s.classId === filterClassId),
    [students, filterClassId]
  )

  // Grades scoped to the class filter
  const scopedGrades = useMemo(() =>
    filterClassId === 'all' ? grades : grades.filter(g => g.classId === filterClassId),
    [grades, filterClassId]
  )

  // Composition stats (use all students/grades, not scoped — KPIs are global)
  const compStats = useMemo(() => {
    const not_started = compositions.filter(c => getCompositionStatus(c, grades, studentsByClass) === 'not_started').length
    const in_progress = compositions.filter(c => getCompositionStatus(c, grades, studentsByClass) === 'in_progress').length
    const completed = compositions.filter(c => getCompositionStatus(c, grades, studentsByClass) === 'completed').length
    return { not_started, in_progress, completed, total: compositions.length }
  }, [compositions, grades, studentsByClass])

  const selectedComp = selectedCompId !== 'annual'
    ? compositions.find(c => c.id === selectedCompId)
    : null

  // Use the selected composition's base, or the first composition's base for annual view
  const maxGrade = selectedComp?.maxGrade ?? compositions[0]?.maxGrade ?? 20

  // Per-class average per subject for the selected composition (filtered by class)
  const classSubjectMatrix = useMemo(() => {
    if (!selectedComp) return null
    const targetClassIds = filterClassId === 'all' ? selectedComp.classIds : selectedComp.classIds.filter(c => c === filterClassId)
    const result: { cls: SchoolClass; subjectAvgs: { subject: Subject; avg: number | null }[]; classAvg: number | null }[] = []

    for (const cid of targetClassIds) {
      const cls = classes.find(c => c.id === cid)
      if (!cls) continue
      const subjectIds = Object.keys(selectedComp.coefficients[cid] ?? {})
      const classStudents = scopedStudents.filter(s => s.classId === cid)

      const subjectAvgs = subjectIds.flatMap(sid => {
        const sub = subjects.find(s => s.id === sid)
        if (!sub) return []
        const subGrades = scopedGrades.filter(g => g.compositionId === selectedComp.id && g.classId === cid && g.subjectId === sid)
        const avgs = subGrades.map(g => g.average).filter((a): a is number => a !== null)
        return [{ subject: sub, avg: avgs.length > 0 ? avgs.reduce((s, a) => s + a, 0) / avgs.length : null }]
      })

      const studentGenAvgs = classStudents.map(student => {
        const sg = scopedGrades.filter(g => g.studentId === student.id && g.compositionId === selectedComp.id && g.classId === cid)
        return calcGeneralAverage(sg.map(g => ({ average: g.average, subjectId: g.subjectId })), selectedComp.coefficients[cid] ?? {})
      }).filter((a): a is number => a !== null)

      const classAvg = studentGenAvgs.length > 0 ? studentGenAvgs.reduce((s, a) => s + a, 0) / studentGenAvgs.length : null
      result.push({ cls, subjectAvgs, classAvg })
    }
    return result
  }, [selectedComp, classes, scopedStudents, subjects, scopedGrades, filterClassId])

  // All students ranked by annual average (scoped to class filter)
  const allStudentsRanked = useMemo(() => {
    return scopedStudents.map(student => {
      const compAvgs = compositions.map(comp => {
        if (!comp.classIds.includes(student.classId)) return null
        const excluded = comp.excludedStudents?.[student.classId] ?? []
        if (excluded.includes(student.id)) return null
        const coeffs = comp.coefficients[student.classId] ?? {}
        const sg = scopedGrades.filter(g => g.studentId === student.id && g.compositionId === comp.id)
        return calcGeneralAverage(sg.map(g => ({ average: g.average, subjectId: g.subjectId })), coeffs)
      })
      const annual = calcAnnualAverage(compAvgs)
      return { student, annual }
    })
      .filter(s => s.annual !== null)
      .sort((a, b) => (b.annual ?? 0) - (a.annual ?? 0))
  }, [scopedStudents, compositions, scopedGrades])

  const topStudents = showAllStudents ? allStudentsRanked : allStudentsRanked.slice(0, 10)
  const hiddenCount = allStudentsRanked.length - 10

  // All subjects ranked by average (scoped to class + composition filter)
  const allSubjectsRanked = useMemo(() => {
    const subjectAvgMap: Record<string, { sum: number; count: number }> = {}

    const targetGrades = selectedCompId === 'annual'
      ? scopedGrades
      : scopedGrades.filter(g => g.compositionId === selectedCompId)

    for (const grade of targetGrades) {
      if (grade.average === null) continue
      if (!subjectAvgMap[grade.subjectId]) subjectAvgMap[grade.subjectId] = { sum: 0, count: 0 }
      subjectAvgMap[grade.subjectId].sum += grade.average
      subjectAvgMap[grade.subjectId].count++
    }

    return Object.entries(subjectAvgMap)
      .flatMap(([subjectId, { sum, count }]) => {
        const subject = subjects.find(s => s.id === subjectId)
        if (!subject) return []
        return [{ subject, avg: sum / count, count }]
      })
      .sort((a, b) => b.avg - a.avg)
  }, [scopedGrades, subjects, selectedCompId])

  if (!activeYear) {
    return <div className="p-8 text-center text-slate-500">Aucune année scolaire active.</div>
  }

  // Only show classes that have at least one composition
  const classesWithCompositions = classes.filter(cls =>
    compositions.some(c => c.classIds.includes(cls.id))
  )

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Tableau de bord pédagogique</h1>
        <p className="text-slate-500 text-sm mt-1">Vue d'ensemble des résultats scolaires</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total compositions" value={compStats.total} color="text-slate-900" />
        <KpiCard label="Terminées" value={compStats.completed} color="text-emerald-600" />
        <KpiCard label="En cours" value={compStats.in_progress} color="text-amber-600" />
        <KpiCard label="Non commencées" value={compStats.not_started} color="text-slate-400" />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Composition filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-500">Composition :</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedCompId('annual')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${selectedCompId === 'annual' ? 'bg-[#00D1FF] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Annuelle
            </button>
            {compositions.map(comp => (
              <button
                key={comp.id}
                onClick={() => setSelectedCompId(comp.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${selectedCompId === comp.id ? 'bg-[#00D1FF] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {comp.name}
              </button>
            ))}
          </div>
        </div>

        {/* Class filter */}
        {classesWithCompositions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-500">Classe :</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterClassId('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${filterClassId === 'all' ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Toutes
              </button>
              {classesWithCompositions.map(cls => (
                <button
                  key={cls.id}
                  onClick={() => setFilterClassId(cls.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${filterClassId === cls.id ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {cls.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-class chart when a composition is selected */}
      {selectedComp && classSubjectMatrix && classSubjectMatrix.length > 0 && (
        <div className="space-y-4">
          {classSubjectMatrix.map(({ cls, subjectAvgs, classAvg }) => (
            <div key={cls.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900">{cls.name}</h2>
                <span className="text-sm font-mono font-bold text-slate-700">
                  Moy. générale : {fmt2(classAvg)}/{maxGrade}
                </span>
              </div>
              <div className="space-y-2">
                {subjectAvgs.map(({ subject, avg }) => (
                  <div key={subject.id} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 w-36 flex-shrink-0 truncate">{subject.name}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${avg !== null ? getMentionBg(avg, maxGrade).includes('emerald') ? 'bg-emerald-400' : getMentionBg(avg, maxGrade).includes('amber') ? 'bg-[#00D1FF]' : 'bg-red-400' : 'bg-slate-200'}`}
                        style={{ width: avg !== null ? `${(avg / maxGrade) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 w-14 text-right">
                      {fmt2(avg)}/{maxGrade}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Annual: per-class summary cards (respect class filter) */}
      {selectedCompId === 'annual' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(filterClassId === 'all' ? classes : classes.filter(c => c.id === filterClassId)).map(cls => {
            const classStudents = students.filter(s => s.classId === cls.id)
            const classComps = compositions.filter(c => c.classIds.includes(cls.id))
            if (classComps.length === 0) return null
            const annualAvgs = classStudents.map(student => {
              const compAvgs = classComps.map(comp => {
                const excluded = comp.excludedStudents?.[cls.id] ?? []
                if (excluded.includes(student.id)) return null
                const coeffs = comp.coefficients[cls.id] ?? {}
                const sg = grades.filter(g => g.studentId === student.id && g.compositionId === comp.id && g.classId === cls.id)
                return calcGeneralAverage(sg.map(g => ({ average: g.average, subjectId: g.subjectId })), coeffs)
              })
              return calcAnnualAverage(compAvgs)
            }).filter((a): a is number => a !== null)
            const classAvg = annualAvgs.length > 0 ? annualAvgs.reduce((s, a) => s + a, 0) / annualAvgs.length : null
            return (
              <div key={cls.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                <p className="font-semibold text-slate-900 mb-1">{cls.name}</p>
                <p className="text-3xl font-bold text-slate-900 mb-1">
                  {fmt2(classAvg)}<span className="text-base font-normal text-slate-400">/{compositions.find(c => c.classIds.includes(cls.id))?.maxGrade ?? maxGrade}</span>
                </p>
                <p className="text-xs text-slate-500">{annualAvgs.length} élève{annualAvgs.length > 1 ? 's' : ''} · {classComps.length} composition{classComps.length > 1 ? 's' : ''}</p>
                {classAvg !== null && (
                  <span className={`mt-2 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${getMentionBg(classAvg, compositions.find(c => c.classIds.includes(cls.id))?.maxGrade ?? maxGrade)}`}>
                    {getMention(classAvg, compositions.find(c => c.classIds.includes(cls.id))?.maxGrade ?? maxGrade)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Top students + Top subjects */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Top élèves */}
        {allStudentsRanked.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-slate-900">Top élèves</h2>
              {filterClassId !== 'all' && (
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  {classes.find(c => c.id === filterClassId)?.name}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-4">Moyenne annuelle · {allStudentsRanked.length} élève{allStudentsRanked.length > 1 ? 's' : ''}</p>
            <div className="space-y-2.5">
              {topStudents.map(({ student, annual }, idx) => (
                <div key={student.id} className="flex items-center gap-3">
                  <span className={`w-5 text-center text-xs font-bold flex-shrink-0 ${idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-slate-400' : idx === 2 ? 'text-orange-700' : 'text-slate-300'}`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {student.lastName} {student.firstName}
                    </p>
                    {filterClassId === 'all' && (
                      <p className="text-xs text-slate-400">{classes.find(c => c.id === student.classId)?.name}</p>
                    )}
                  </div>
                  <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden flex-shrink-0">
                    <div
                      className={`h-full rounded-full ${getMentionBg(annual ?? 0, maxGrade).includes('emerald') ? 'bg-emerald-400' : getMentionBg(annual ?? 0, maxGrade).includes('amber') ? 'bg-[#00D1FF]' : 'bg-red-400'}`}
                      style={{ width: `${((annual ?? 0) / maxGrade) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono font-bold text-slate-900 w-10 text-right flex-shrink-0">
                    {fmt2(annual)}
                  </span>
                  {annual !== null && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${getMentionBg(annual, maxGrade)}`}>
                      {getMention(annual, maxGrade)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {allStudentsRanked.length > 10 && (
              <button
                onClick={() => setShowAllStudents(v => !v)}
                className="mt-4 w-full text-center text-sm text-[#00D1FF] hover:text-[#00b8e0] font-medium py-2 border border-[#00D1FF]/30 rounded-xl hover:bg-[#00D1FF]/5 transition-all"
              >
                {showAllStudents ? 'Réduire' : `Voir les ${hiddenCount} autre${hiddenCount > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        )}

        {/* Classement matières — liste exhaustive */}
        {allSubjectsRanked.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-slate-900">Classement des matières</h2>
              {filterClassId !== 'all' && (
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  {classes.find(c => c.id === filterClassId)?.name}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-4">
              {selectedCompId === 'annual' ? 'Toutes compositions · ' : ''}
              {allSubjectsRanked.length} matière{allSubjectsRanked.length > 1 ? 's' : ''}
            </p>
            <div className="space-y-2.5">
              {allSubjectsRanked.map(({ subject, avg, count }, idx) => {
                const barColor = getMentionBg(avg, maxGrade).includes('emerald') ? 'bg-emerald-400' : getMentionBg(avg, maxGrade).includes('amber') ? 'bg-[#00D1FF]' : 'bg-red-400'
                const medalColor = idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-slate-400' : idx === 2 ? 'text-orange-700' : 'text-slate-300'
                return (
                  <div key={subject.id} className="flex items-center gap-3">
                    <span className={`w-5 text-center text-xs font-bold flex-shrink-0 ${medalColor}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{subject.name}</p>
                      <p className="text-xs text-slate-400">{count} note{count > 1 ? 's' : ''}</p>
                    </div>
                    <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden flex-shrink-0">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${(avg / maxGrade) * 100}%` }} />
                    </div>
                    <span className="text-sm font-mono font-bold text-slate-900 w-10 text-right flex-shrink-0">
                      {fmt2(avg)}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${getMentionBg(avg, maxGrade)}`}>
                      {getMention(avg, maxGrade)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
