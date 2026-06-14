'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore'
import { db } from '../../../_lib/firebase'
import { useSchoolYear } from '../../../_lib/school-year-context'
import { Composition, SchoolClass, Subject, Student, Grade } from '../../../_lib/types'
import {
  getCompositionStatus, statusLabel, statusClass,
  calcSubjectAverage, calcGeneralAverage, getMention, getMentionBg, fmt2,
} from '../../../_lib/grade-utils'
import { generateClassBulletins } from '../../../_lib/bulletin-generator'

export default function CompositionDetailPage() {
  const { compositionId } = useParams() as { compositionId: string }
  const router = useRouter()
  const { activeYear, uid } = useSchoolYear()
  const [tab, setTab] = useState<'classes' | 'bulletins'>('classes')

  const [composition, setComposition] = useState<Composition | null>(null)
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [generatingClass, setGeneratingClass] = useState<string | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [schoolSettings, setSchoolSettings] = useState<{ name: string; address?: string; phone?: string; email?: string }>({ name: '' })
  const [compositions, setCompositions] = useState<Composition[]>([])
  const [allYearGrades, setAllYearGrades] = useState<Grade[]>([])

  useEffect(() => {
    if (!uid) return
    getDoc(doc(db, 'settings', uid)).then(d => {
      if (d.exists()) setSchoolSettings(d.data() as any)
    })
  }, [uid])

  useEffect(() => {
    getDoc(doc(db, 'compositions', compositionId)).then(d => {
      if (d.exists()) setComposition({ id: d.id, ...d.data() } as Composition)
    })
  }, [compositionId])

  useEffect(() => {
    if (!activeYear?.id || !uid) return
    const yid = activeYear.id
    const u1 = onSnapshot(
      query(collection(db, 'classes'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setClasses(s.docs.map(d => ({ id: d.id, ...d.data() } as SchoolClass)))
    )
    const u2 = onSnapshot(query(collection(db, 'subjects'), where('userId', '==', uid)),
      s => setSubjects(s.docs.map(d => ({ id: d.id, ...d.data() } as Subject)))
    )
    const u3 = onSnapshot(
      query(collection(db, 'students'), where('schoolYearId', '==', yid), where('userId', '==', uid), where('isActive', '==', true)),
      s => setStudents(s.docs.map(d => ({ id: d.id, ...d.data() } as Student)))
    )
    const u4 = onSnapshot(
      query(collection(db, 'grades'), where('compositionId', '==', compositionId)),
      s => setGrades(s.docs.map(d => ({ id: d.id, ...d.data() } as Grade)))
    )
    const u5 = onSnapshot(
      query(collection(db, 'compositions'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setCompositions(s.docs.map(d => ({ id: d.id, ...d.data() } as Composition)))
    )
    const u6 = onSnapshot(
      query(collection(db, 'grades'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setAllYearGrades(s.docs.map(d => ({ id: d.id, ...d.data() } as Grade)))
    )
    return () => { u1(); u2(); u3(); u4(); u5(); u6() }
  }, [activeYear?.id, uid, compositionId])

  const studentsByClass = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const s of students) {
      if (!map[s.classId]) map[s.classId] = []
      map[s.classId].push(s.id)
    }
    return map
  }, [students])

  // For each class: compute per-student general averages
  const classStats = useMemo(() => {
    if (!composition) return {}
    const result: Record<string, { avg: number | null; count: number; completed: number }> = {}
    for (const cid of composition.classIds) {
      const classStudents = students.filter(s => s.classId === cid)
      const subjectIds = Object.keys(composition.coefficients[cid] ?? {})
      let completed = 0
      let totalAvg = 0
      let avgCount = 0
      for (const student of classStudents) {
        const studentGrades = grades.filter(g => g.studentId === student.id && g.classId === cid)
        const genAvg = calcGeneralAverage(
          studentGrades.map(g => ({ average: g.average, subjectId: g.subjectId })),
          composition.coefficients[cid] ?? {}
        )
        if (genAvg !== null) {
          completed++
          totalAvg += genAvg
          avgCount++
        }
      }
      result[cid] = {
        avg: avgCount > 0 ? totalAvg / avgCount : null,
        count: classStudents.length,
        completed,
      }
    }
    return result
  }, [composition, students, grades])

  function getClassStatus(cid: string): 'not_started' | 'in_progress' | 'completed' {
    if (!composition) return 'not_started'
    const stats = classStats[cid]
    if (!stats || stats.completed === 0) return 'not_started'
    if (stats.completed < stats.count) return 'in_progress'
    return 'completed'
  }

  async function handleGenerateBulletins(classId: string | 'all') {
    if (!composition) return
    const targetClasses = classId === 'all' ? composition.classIds : [classId]
    classId === 'all' ? setGeneratingAll(true) : setGeneratingClass(classId)
    try {
      for (const cid of targetClasses) {
        const cls = classes.find(c => c.id === cid)
        const classStudents = students.filter(s => s.classId === cid).sort((a, b) =>
          `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
        )
        await generateClassBulletins({
          composition,
          classInfo: cls ?? { id: cid, name: cid, schoolYearId: '' },
          students: classStudents,
          subjects,
          grades,
          allCompositions: compositions,
          allGrades: allYearGrades,
          schoolName: schoolSettings.name,
          schoolAddress: schoolSettings.address,
          schoolPhone: schoolSettings.phone,
          schoolEmail: schoolSettings.email,
          schoolYearLabel: activeYear ? `${activeYear.startYear}/${activeYear.endYear}` : undefined,
        })
      }
    } finally {
      setGeneratingAll(false)
      setGeneratingClass(null)
    }
  }

  if (!composition) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const overallStatus = getCompositionStatus(composition, grades, studentsByClass)

  return (
    <div className="p-6 md:p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/dashboard/pedagogie" className="hover:text-[#00D1FF] transition-colors">Compositions</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-slate-900 font-medium truncate">{composition.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-900">{composition.name}</h1>
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusClass(overallStatus)}`}>
              {statusLabel(overallStatus)}
            </span>
          </div>
          <p className="text-slate-500 text-sm">
            {composition.noteCount} note{composition.noteCount > 1 ? 's' : ''} par matière
            {' · '}
            {composition.classIds.length} classe{composition.classIds.length > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {(['classes', 'bulletins'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'classes' ? 'Classes' : 'Bulletins'}
          </button>
        ))}
      </div>

      {tab === 'classes' && (
        <div className="grid gap-3">
          {composition.classIds.map(cid => {
            const cls = classes.find(c => c.id === cid)
            const stats = classStats[cid]
            const cStatus = getClassStatus(cid)
            const subjectCount = Object.keys(composition.coefficients[cid] ?? {}).length
            return (
              <div key={cid} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-slate-900">{cls?.name ?? cid}</h3>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass(cStatus)}`}>
                      {statusLabel(cStatus)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">
                    {stats?.completed ?? 0}/{stats?.count ?? 0} élèves notés
                    {stats?.avg !== null && stats?.avg !== undefined
                      ? ` · Moyenne : ${fmt2(stats.avg)}/${composition.maxGrade ?? 20}`
                      : ''}
                    {' · '}{subjectCount} matière{subjectCount > 1 ? 's' : ''}
                  </p>
                </div>
                <Link
                  href={`/dashboard/pedagogie/${compositionId}/${cid}`}
                  className="px-4 py-2 bg-[#00D1FF]/10 text-[#00D1FF] rounded-xl text-sm font-semibold hover:bg-[#00D1FF]/20 transition-colors flex-shrink-0"
                >
                  Saisir les notes
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'bulletins' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            Les bulletins sont générés en PDF (2 par page A4). Seuls les élèves avec toutes leurs notes saisies apparaissent.
          </div>

          {/* All classes */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-900">Toutes les classes</p>
              <p className="text-sm text-slate-500">{composition.classIds.length} classe{composition.classIds.length > 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => handleGenerateBulletins('all')}
              disabled={generatingAll}
              className="px-4 py-2 bg-[#00D1FF] text-white rounded-xl text-sm font-semibold hover:bg-[#00b8e0] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {generatingAll ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Génération…</>
              ) : (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>Télécharger tout</>
              )}
            </button>
          </div>

          {/* Per class */}
          {composition.classIds.map(cid => {
            const cls = classes.find(c => c.id === cid)
            const stats = classStats[cid]
            return (
              <div key={cid} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{cls?.name ?? cid}</p>
                  <p className="text-sm text-slate-500">{stats?.completed ?? 0} bulletin{(stats?.completed ?? 0) > 1 ? 's' : ''} disponible{(stats?.completed ?? 0) > 1 ? 's' : ''}</p>
                </div>
                <button
                  onClick={() => handleGenerateBulletins(cid)}
                  disabled={generatingClass === cid || (stats?.completed ?? 0) === 0}
                  className="px-4 py-2 bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-100 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {generatingClass === cid ? (
                    <><div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />Génération…</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>Télécharger</>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
