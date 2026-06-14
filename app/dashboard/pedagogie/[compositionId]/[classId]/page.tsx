'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { collection, query, where, onSnapshot, getDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../../_lib/firebase'
import { useSchoolYear } from '../../../../_lib/school-year-context'
import { Composition, SchoolClass, Subject, Student, Grade } from '../../../../_lib/types'
import { calcGeneralAverage, getMention, getMentionBg, fmt2 } from '../../../../_lib/grade-utils'

export default function ClassCompositionPage() {
  const { compositionId, classId } = useParams() as { compositionId: string; classId: string }
  const { activeYear, uid } = useSchoolYear()

  const [composition, setComposition] = useState<Composition | null>(null)
  const [classInfo, setClassInfo] = useState<SchoolClass | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  const [showManageSubjects, setShowManageSubjects] = useState(false)
  const [showManageStudents, setShowManageStudents] = useState(false)

  useEffect(() => {
    const u = onSnapshot(doc(db, 'compositions', compositionId), d => {
      if (d.exists()) setComposition({ id: d.id, ...d.data() } as Composition)
    })
    getDoc(doc(db, 'classes', classId)).then(d => {
      if (d.exists()) setClassInfo({ id: d.id, ...d.data() } as SchoolClass)
    })
    return () => u()
  }, [compositionId, classId])

  useEffect(() => {
    if (!activeYear?.id || !uid) return
    const u1 = onSnapshot(query(collection(db, 'subjects'), where('userId', '==', uid)), s =>
      setSubjects(s.docs.map(d => ({ id: d.id, ...d.data() } as Subject)))
    )
    const u2 = onSnapshot(
      query(collection(db, 'students'), where('schoolYearId', '==', activeYear.id), where('userId', '==', uid), where('classId', '==', classId)),
      s => setStudents(s.docs.map(d => ({ id: d.id, ...d.data() } as Student)).sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
      ))
    )
    const u3 = onSnapshot(
      query(collection(db, 'grades'), where('compositionId', '==', compositionId), where('classId', '==', classId)),
      s => setGrades(s.docs.map(d => ({ id: d.id, ...d.data() } as Grade)))
    )
    return () => { u1(); u2(); u3() }
  }, [activeYear?.id, uid, compositionId, classId])

  const excludedStudentIds = useMemo(() =>
    composition?.excludedStudents?.[classId] ?? [],
    [composition, classId]
  )

  const activeStudents = useMemo(() =>
    students.filter(s => s.isActive && !excludedStudentIds.includes(s.id)),
    [students, excludedStudentIds]
  )

  const classSubjectIds = useMemo(() =>
    composition ? Object.keys(composition.coefficients[classId] ?? {}) : [],
    [composition, classId]
  )

  const classSubjects = useMemo(() =>
    subjects.filter(s => classSubjectIds.includes(s.id)),
    [subjects, classSubjectIds]
  )

  const subjectStats = useMemo(() => {
    const map: Record<string, { completed: number; classAvg: number | null }> = {}
    for (const sub of classSubjects) {
      const subGrades = grades.filter(g => g.subjectId === sub.id)
      const completed = subGrades.filter(g => g.average !== null).length
      const avgs = subGrades.map(g => g.average).filter((a): a is number => a !== null)
      map[sub.id] = {
        completed,
        classAvg: avgs.length > 0 ? avgs.reduce((s, a) => s + a, 0) / avgs.length : null,
      }
    }
    return map
  }, [grades, classSubjects])

  const studentAverages = useMemo(() => {
    if (!composition) return {}
    const coeffs = composition.coefficients[classId] ?? {}
    const map: Record<string, number | null> = {}
    for (const student of activeStudents) {
      const sg = grades.filter(g => g.studentId === student.id)
      map[student.id] = calcGeneralAverage(sg.map(g => ({ average: g.average, subjectId: g.subjectId })), coeffs)
    }
    return map
  }, [composition, grades, activeStudents, classId])

  if (!composition || !classInfo) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6 flex-wrap">
        <Link href="/dashboard/pedagogie" className="hover:text-[#00D1FF] transition-colors">Compositions</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <Link href={`/dashboard/pedagogie/${compositionId}`} className="hover:text-[#00D1FF] transition-colors">{composition.name}</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="text-slate-900 font-medium">{classInfo.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{classInfo.name}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {activeStudents.length} élève{activeStudents.length > 1 ? 's' : ''}
            {excludedStudentIds.length > 0 && ` · ${excludedStudentIds.length} exclu${excludedStudentIds.length > 1 ? 's' : ''}`}
            {' · '}{classSubjects.length} matière{classSubjects.length > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setShowManageSubjects(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Gérer les matières
          </button>
          <button
            onClick={() => setShowManageStudents(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Gérer les élèves
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subjects — navigate to grade entry */}
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-3">Saisie des notes par matière</h2>
          {classSubjects.length === 0 ? (
            <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              Aucune matière. Cliquez sur "Gérer les matières" pour en ajouter.
            </div>
          ) : (
            <div className="space-y-2">
              {classSubjects.map(sub => {
                const stats = subjectStats[sub.id]
                const coeff = composition.coefficients[classId]?.[sub.id] ?? 1
                const isDone = stats.completed === activeStudents.length && activeStudents.length > 0
                return (
                  <Link
                    key={sub.id}
                    href={`/dashboard/pedagogie/${compositionId}/${classId}/${sub.id}`}
                    className="flex items-center gap-4 bg-white rounded-xl border border-slate-200 p-4 hover:border-[#00D1FF] hover:shadow-sm transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-slate-900">{sub.name}</span>
                        <span className="text-xs text-slate-400">coeff. {coeff}</span>
                        {isDone && (
                          <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Terminé</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {stats.completed}/{activeStudents.length} notés
                        {stats.classAvg !== null ? ` · Moy. ${fmt2(stats.classAvg)}/20` : ''}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-[#00D1FF] transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Students general averages */}
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-3">Moyennes générales</h2>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Rang</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Élève</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Moy.</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Mention</th>
                </tr>
              </thead>
              <tbody>
                {activeStudents.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-4 text-center text-sm text-slate-400">Aucun élève actif.</td></tr>
                )}
                {[...activeStudents]
                  .map(s => ({ student: s, avg: studentAverages[s.id] ?? null }))
                  .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
                  .map(({ student, avg }, idx) => (
                    <tr key={student.id} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{avg !== null ? idx + 1 : '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{student.lastName} {student.firstName}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">{fmt2(avg)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {avg !== null ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getMentionBg(avg)}`}>{getMention(avg)}</span>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Excluded students notice */}
          {excludedStudentIds.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {excludedStudentIds.length} élève{excludedStudentIds.length > 1 ? 's exclu·e·s' : ' exclu·e'} de cette composition
              <button onClick={() => setShowManageStudents(true)} className="text-[#00D1FF] hover:underline ml-1">Modifier</button>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showManageSubjects && (
        <ManageSubjectsModal
          composition={composition}
          classId={classId}
          allSubjects={subjects}
          onClose={() => setShowManageSubjects(false)}
        />
      )}
      {showManageStudents && (
        <ManageStudentsModal
          composition={composition}
          classId={classId}
          students={students}
          onClose={() => setShowManageStudents(false)}
        />
      )}
    </div>
  )
}

// ─── Manage Subjects Modal ────────────────────────────────────────────────────

function ManageSubjectsModal({
  composition, classId, allSubjects, onClose,
}: {
  composition: Composition
  classId: string
  allSubjects: Subject[]
  onClose: () => void
}) {
  const currentCoeffs = composition.coefficients[classId] ?? {}
  const [coeffs, setCoeffs] = useState<Record<string, number>>(
    Object.fromEntries(Object.entries(currentCoeffs))
  )
  const [saving, setSaving] = useState(false)

  function toggleSubject(subId: string) {
    setCoeffs(prev => {
      const next = { ...prev }
      if (next[subId] !== undefined) {
        delete next[subId]
      } else {
        next[subId] = 1
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const newCoefficients = {
        ...composition.coefficients,
        [classId]: coeffs,
      }
      await updateDoc(doc(db, 'compositions', composition.id), { coefficients: newCoefficients })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = Object.keys(coeffs).length

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Gérer les matières</h2>
            <p className="text-sm text-slate-500">{selectedCount} matière{selectedCount > 1 ? 's' : ''} sélectionnée{selectedCount > 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {allSubjects.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">Aucune matière disponible. Ajoutez-en depuis la page Matières.</p>
          )}
          {allSubjects.map(sub => {
            const isActive = coeffs[sub.id] !== undefined
            return (
              <div key={sub.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isActive ? 'border-[#00D1FF] bg-[#00D1FF]/5' : 'border-slate-200 hover:border-slate-300'}`}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleSubject(sub.id)}
                  className="w-4 h-4 accent-[#00D1FF] flex-shrink-0"
                />
                <span className="flex-1 text-sm font-medium text-slate-900">{sub.name}</span>
                {isActive && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">coeff.</span>
                    <input
                      type="number"
                      min="0.5" max="20" step="0.5"
                      value={coeffs[sub.id] ?? 1}
                      onChange={e => setCoeffs(prev => ({ ...prev, [sub.id]: parseFloat(e.target.value) || 1 }))}
                      className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF]"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-between">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#00D1FF] text-white text-sm font-semibold rounded-xl hover:bg-[#00b8e0] transition-colors disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Manage Students Modal ────────────────────────────────────────────────────

function ManageStudentsModal({
  composition, classId, students, onClose,
}: {
  composition: Composition
  classId: string
  students: Student[]
  onClose: () => void
}) {
  const currentExcluded = composition.excludedStudents?.[classId] ?? []
  // Inactive students are always forced into the excluded set
  const inactiveIds = useMemo(() => new Set(students.filter(s => !s.isActive).map(s => s.id)), [students])
  const [excluded, setExcluded] = useState<Set<string>>(
    new Set([...currentExcluded, ...students.filter(s => !s.isActive).map(s => s.id)])
  )
  const [saving, setSaving] = useState(false)

  function toggle(student: Student) {
    if (!student.isActive) return // cannot include inactive students
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(student.id)) { next.delete(student.id) } else { next.add(student.id) }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Never save inactive students as "excluded" explicitly — they're always excluded by isActive logic
      const manuallyExcluded = [...excluded].filter(id => !inactiveIds.has(id))
      const newExcluded = {
        ...(composition.excludedStudents ?? {}),
        [classId]: manuallyExcluded,
      }
      await updateDoc(doc(db, 'compositions', composition.id), { excludedStudents: newExcluded })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const activeStudentsInClass = students.filter(s => s.isActive)
  const manuallyExcluded = [...excluded].filter(id => !inactiveIds.has(id)).length
  const includedCount = activeStudentsInClass.length - manuallyExcluded

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Gérer les élèves</h2>
            <p className="text-sm text-slate-500">
              {includedCount} inclus
              {manuallyExcluded > 0 && ` · ${manuallyExcluded} exclu${manuallyExcluded > 1 ? 's' : ''}`}
              {inactiveIds.size > 0 && ` · ${inactiveIds.size} inactif${inactiveIds.size > 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          Les élèves exclus n'apparaissent pas dans la saisie des notes ni dans les classements. Les élèves inactifs ne peuvent pas être ajoutés.
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {students.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">Aucun élève dans cette classe.</p>
          )}
          {activeStudentsInClass.length > 0 && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setExcluded(new Set([...inactiveIds]))}
                className="text-xs text-[#00D1FF] hover:underline"
              >
                Inclure tous les actifs
              </button>
              <span className="text-slate-300">·</span>
              <button
                onClick={() => setExcluded(new Set(students.map(s => s.id)))}
                className="text-xs text-red-500 hover:underline"
              >
                Exclure tous
              </button>
            </div>
          )}
          {students.map(student => {
            const isInactive = !student.isActive
            const isExcluded = excluded.has(student.id)
            return (
              <div
                key={student.id}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  isInactive
                    ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                    : isExcluded
                    ? 'border-red-200 bg-red-50 cursor-pointer'
                    : 'border-slate-200 hover:border-slate-300 cursor-pointer'
                }`}
                onClick={() => toggle(student)}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isInactive ? 'border-slate-300 bg-slate-300'
                  : isExcluded ? 'border-red-400 bg-red-400'
                  : 'border-[#00D1FF] bg-[#00D1FF]'
                }`}>
                  {isInactive ? (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M18 12H6" /></svg>
                  ) : isExcluded ? (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                  ) : (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <span className={`flex-1 text-sm font-medium ${isInactive ? 'text-slate-400' : isExcluded ? 'text-red-600 line-through' : 'text-slate-900'}`}>
                  {student.lastName} {student.firstName}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isInactive ? 'bg-slate-100 text-slate-500'
                  : isExcluded ? 'bg-red-100 text-red-600'
                  : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {isInactive ? 'Inactif' : isExcluded ? 'Exclu' : 'Inclus'}
                </span>
              </div>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-between">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#00D1FF] text-white text-sm font-semibold rounded-xl hover:bg-[#00b8e0] transition-colors disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
