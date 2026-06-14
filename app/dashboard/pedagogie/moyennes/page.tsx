'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { Composition, SchoolClass, Subject, Student, Grade } from '../../../_lib/types'
import {
  calcGeneralAverage, calcAnnualAverage, getMention, getMentionBg, fmt2,
} from '../../../_lib/grade-utils'
import { generateAnnualBulletins } from '../../../_lib/annual-bulletin-generator'

export default function MoyennesPage() {
  const { activeYear, uid } = useSchoolYear()
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [compositions, setCompositions] = useState<Composition[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [generating, setGenerating] = useState(false)
  const [schoolSettings, setSchoolSettings] = useState<{ name: string; address?: string; phone?: string; email?: string }>({ name: '' })

  useEffect(() => {
    if (!uid) return
    getDoc(doc(db, 'settings', uid)).then(d => {
      if (d.exists()) setSchoolSettings(d.data() as any)
    })
  }, [uid])

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
      s => setStudents(s.docs.map(d => ({ id: d.id, ...d.data() } as Student)).sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
      ))
    )
    const u5 = onSnapshot(
      query(collection(db, 'grades'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setGrades(s.docs.map(d => ({ id: d.id, ...d.data() } as Grade)))
    )
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [activeYear?.id, uid])

  const classStudents = useMemo(() =>
    selectedClassId ? students.filter(s => s.classId === selectedClassId) : [],
    [students, selectedClassId]
  )

  // Compositions that include the selected class
  const relevantCompositions = useMemo(() =>
    compositions.filter(c => c.classIds.includes(selectedClassId)),
    [compositions, selectedClassId]
  )

  // Per student: array of general averages per composition + annual average
  const studentStats = useMemo(() => {
    return classStudents.map(student => {
      const compAvgs = relevantCompositions.map(comp => {
        const coeffs = comp.coefficients[selectedClassId] ?? {}
        const studentGrades = grades.filter(
          g => g.studentId === student.id && g.compositionId === comp.id && g.classId === selectedClassId
        )
        return calcGeneralAverage(
          studentGrades.map(g => ({ average: g.average, subjectId: g.subjectId })),
          coeffs
        )
      })
      const annualAvg = calcAnnualAverage(compAvgs)
      return { student, compAvgs, annualAvg }
    })
  }, [classStudents, relevantCompositions, grades, selectedClassId])

  // Sort by annual average descending
  const ranked = useMemo(() =>
    [...studentStats]
      .sort((a, b) => (b.annualAvg ?? -1) - (a.annualAvg ?? -1))
      .map((row, idx) => ({ ...row, rank: row.annualAvg !== null ? idx + 1 : null })),
    [studentStats]
  )

  async function handleGenerateBulletins() {
    if (!activeYear) return
    const cls = classes.find(c => c.id === selectedClassId)
    if (!cls) return
    setGenerating(true)
    try {
      await generateAnnualBulletins({
        classes: [cls],
        students: classStudents,
        compositions: relevantCompositions,
        subjects,
        grades,
        schoolName: schoolSettings.name,
        schoolAddress: schoolSettings.address,
        schoolPhone: schoolSettings.phone,
        schoolEmail: schoolSettings.email,
        schoolYear: activeYear,
      })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Moyennes annuelles</h1>
        <p className="text-slate-500 text-sm mt-1">Classement et bulletins de fin d'année</p>
      </div>

      {!activeYear && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center text-slate-500">
          Aucune année scolaire active.
        </div>
      )}

      {activeYear && (
        <>
          {/* Class selector */}
          <div className="flex items-center gap-3 mb-6">
            <label className="text-sm font-medium text-slate-700 flex-shrink-0">Classe :</label>
            <select
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF] bg-white"
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
            >
              <option value="">Sélectionner une classe</option>
              {classes.map(cls => (
                <option key={cls.id} value={cls.id}>{cls.name}</option>
              ))}
            </select>
            {selectedClassId && ranked.some(r => r.annualAvg !== null) && (
              <button
                onClick={handleGenerateBulletins}
                disabled={generating}
                className="ml-auto px-4 py-2 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold hover:bg-[#00b8e0] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {generating ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Génération…</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>Bulletins annuels PDF</>
                )}
              </button>
            )}
          </div>

          {selectedClassId && relevantCompositions.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-8 text-center text-slate-500 text-sm">
              Aucune composition pour cette classe.
            </div>
          )}

          {selectedClassId && relevantCompositions.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 sticky left-0 bg-white">Rang</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 sticky left-8 bg-white min-w-[160px]">Élève</th>
                    {relevantCompositions.map(comp => (
                      <th key={comp.id} className="text-center px-3 py-3 text-xs font-semibold text-slate-500 min-w-[90px]">
                        {comp.name}
                      </th>
                    ))}
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-900 min-w-[100px]">Moy. annuelle</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500">Mention</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(({ student, compAvgs, annualAvg, rank }, idx) => (
                    <tr key={student.id} className={`border-t border-slate-50 hover:bg-slate-50 transition-colors ${idx < 3 && rank !== null ? 'font-medium' : ''}`}>
                      <td className="px-4 py-3 text-slate-400 text-xs sticky left-0 bg-white">
                        {rank !== null ? (
                          <span className={`font-bold ${rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-amber-700' : 'text-slate-500'}`}>
                            {rank}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 sticky left-8 bg-white">
                        {student.lastName} {student.firstName}
                      </td>
                      {compAvgs.map((avg, i) => (
                        <td key={i} className="px-3 py-3 text-center">
                          <span className={`font-mono text-sm ${avg !== null ? (avg >= 10 ? 'text-emerald-600' : 'text-red-500') : 'text-slate-300'}`}>
                            {fmt2(avg)}
                          </span>
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        <span className={`font-mono font-bold text-base ${annualAvg !== null ? (annualAvg >= 10 ? 'text-emerald-700' : 'text-red-600') : 'text-slate-300'}`}>
                          {fmt2(annualAvg)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {annualAvg !== null ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getMentionBg(annualAvg)}`}>
                            {getMention(annualAvg)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
