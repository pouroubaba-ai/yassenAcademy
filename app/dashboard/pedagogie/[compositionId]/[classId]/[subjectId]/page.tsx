'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  collection, query, where, onSnapshot, getDoc, doc,
  getDocs, addDoc, updateDoc,
} from 'firebase/firestore'
import { db } from '../../../../../_lib/firebase'
import { useSchoolYear } from '../../../../../_lib/school-year-context'
import { Composition, SchoolClass, Subject, Student, Grade } from '../../../../../_lib/types'
import { calcSubjectAverage, fmt2 } from '../../../../../_lib/grade-utils'

export default function GradeEntryPage() {
  const { compositionId, classId, subjectId } = useParams() as {
    compositionId: string; classId: string; subjectId: string
  }
  const { activeYear, uid } = useSchoolYear()

  const [composition, setComposition] = useState<Composition | null>(null)
  const [classInfo, setClassInfo] = useState<SchoolClass | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // Local editable state: studentId -> notes array
  const [localNotes, setLocalNotes] = useState<Record<string, (string)[]>>({})
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    // Live-listen to composition so excluded students update in real time
    const u = onSnapshot(doc(db, 'compositions', compositionId), d => {
      if (d.exists()) setComposition({ id: d.id, ...d.data() } as Composition)
    })
    Promise.all([
      getDoc(doc(db, 'classes', classId)),
      getDoc(doc(db, 'subjects', subjectId)),
    ]).then(([clsDoc, subDoc]) => {
      if (clsDoc.exists()) setClassInfo({ id: clsDoc.id, ...clsDoc.data() } as SchoolClass)
      if (subDoc.exists()) setSubject({ id: subDoc.id, ...subDoc.data() } as Subject)
    })
    return () => u()
  }, [compositionId, classId, subjectId])

  useEffect(() => {
    if (!activeYear?.id || !uid) return
    const u1 = onSnapshot(
      query(collection(db, 'students'), where('schoolYearId', '==', activeYear.id), where('userId', '==', uid), where('classId', '==', classId), where('isActive', '==', true)),
      s => setStudents(s.docs.map(d => ({ id: d.id, ...d.data() } as Student)).sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
      ))
    )
    const u2 = onSnapshot(
      query(collection(db, 'grades'), where('compositionId', '==', compositionId), where('classId', '==', classId), where('subjectId', '==', subjectId)),
      s => {
        const loaded = s.docs.map(d => ({ id: d.id, ...d.data() } as Grade))
        setGrades(loaded)
        // Init local notes from Firestore (don't overwrite if user is editing)
        setLocalNotes(prev => {
          const next = { ...prev }
          for (const g of loaded) {
            if (!next[g.studentId]) {
              next[g.studentId] = g.notes.map(n => n === null ? '' : String(n))
            }
          }
          return next
        })
      }
    )
    return () => { u1(); u2() }
  }, [activeYear?.id, uid, compositionId, classId, subjectId])

  // Active students = class students minus excluded
  const activeStudents = useMemo(() => {
    const excluded = composition?.excludedStudents?.[classId] ?? []
    return students.filter(s => !excluded.includes(s.id))
  }, [students, composition, classId])

  // Init localNotes when students load
  useEffect(() => {
    if (!composition) return
    setLocalNotes(prev => {
      const next = { ...prev }
      for (const s of activeStudents) {
        if (!next[s.id]) {
          next[s.id] = Array(composition.noteCount).fill('')
        }
      }
      return next
    })
  }, [activeStudents, composition])

  async function saveGrade(studentId: string) {
    if (!composition || !activeYear?.id) return
    const notes = localNotes[studentId] ?? []
    const parsed: (number | null)[] = notes.map(n => {
      const v = parseFloat(n)
      return isNaN(v) ? null : Math.max(0, Math.min(composition.maxGrade ?? 20, v))
    })
    const avg = calcSubjectAverage(parsed, composition.noteCount)

    setSaving(prev => ({ ...prev, [studentId]: true }))
    try {
      const existing = grades.find(g => g.studentId === studentId)
      if (existing) {
        await updateDoc(doc(db, 'grades', existing.id), { notes: parsed, average: avg, updatedAt: new Date().toISOString() })
      } else {
        await addDoc(collection(db, 'grades'), {
          compositionId,
          schoolYearId: activeYear.id,
          userId: uid,
          studentId,
          classId,
          subjectId,
          notes: parsed,
          average: avg,
          updatedAt: new Date().toISOString(),
        })
      }
    } finally {
      setSaving(prev => ({ ...prev, [studentId]: false }))
    }
  }

  function setNote(studentId: string, noteIdx: number, value: string) {
    const max = composition?.maxGrade ?? 20
    const num = parseFloat(value)
    const clamped = (!isNaN(num) && num > max) ? String(max) : value
    setLocalNotes(prev => ({
      ...prev,
      [studentId]: (prev[studentId] ?? Array(composition?.noteCount ?? 1).fill('')).map(
        (n, i) => i === noteIdx ? clamped : n
      ),
    }))
  }

  function handleKeyDown(e: React.KeyboardEvent, studentIdx: number, noteIdx: number) {
    if (!composition) return
    const noteCount = composition.noteCount

    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      // Move to next cell: next note or next student
      let nextStudent = studentIdx
      let nextNote = noteIdx + 1
      if (nextNote >= noteCount) {
        nextNote = 0
        nextStudent = studentIdx + 1
      }
      if (nextStudent < activeStudents.length) {
        const key = `${activeStudents[nextStudent].id}-${nextNote}`
        inputRefs.current[key]?.focus()
      }
    }
    if (e.key === 'ArrowUp' && studentIdx > 0) {
      e.preventDefault()
      const key = `${activeStudents[studentIdx - 1].id}-${noteIdx}`
      inputRefs.current[key]?.focus()
    }
    if (e.key === 'ArrowDown' && studentIdx < activeStudents.length - 1) {
      e.preventDefault()
      const key = `${activeStudents[studentIdx + 1].id}-${noteIdx}`
      inputRefs.current[key]?.focus()
    }
  }

  // Only count grades for active (non-excluded) students
  const activeStudentIds = useMemo(() => new Set(activeStudents.map(s => s.id)), [activeStudents])
  const activeGrades = useMemo(() => grades.filter(g => activeStudentIds.has(g.studentId)), [grades, activeStudentIds])

  const classAvg = useMemo(() => {
    const avgs = activeGrades.map(g => g.average).filter((a): a is number => a !== null)
    if (avgs.length === 0) return null
    return avgs.reduce((s, a) => s + a, 0) / avgs.length
  }, [activeGrades])

  const completedCount = activeGrades.filter(g => g.average !== null).length

  if (!composition || !classInfo || !subject) {
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
        <Link href={`/dashboard/pedagogie/${compositionId}/${classId}`} className="hover:text-[#00D1FF] transition-colors">{classInfo.name}</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="text-slate-900 font-medium">{subject.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{subject.name}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {classInfo.name} · {composition.name} · coeff. {composition.coefficients[classId]?.[subjectId] ?? 1}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-slate-900">{completedCount}/{activeStudents.length}</p>
          <p className="text-xs text-slate-500">notés {classAvg !== null ? `· Moy. ${fmt2(classAvg)}/${composition.maxGrade ?? 20}` : ''}</p>
        </div>
      </div>

      <div className="text-xs text-slate-400 mb-4">
        Utilisez Tab / Entrée pour passer à la cellule suivante · ↑↓ pour changer de ligne · Les notes sont sauvegardées automatiquement à la sortie du champ.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 min-w-[180px]">Élève</th>
              {composition.noteNames.slice(0, composition.noteCount).map((name, i) => (
                <th key={i} className="text-center px-3 py-3 text-xs font-semibold text-slate-500 min-w-[100px]">
                  {name}
                  <span className="text-slate-300 font-normal">/{composition.maxGrade ?? 20}</span>
                </th>
              ))}
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500">Moyenne</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {activeStudents.map((student, si) => {
              const notes = localNotes[student.id] ?? Array(composition.noteCount).fill('')
              const parsed: (number | null)[] = notes.map(n => {
                const v = parseFloat(n)
                return isNaN(v) ? null : v
              })
              const avg = calcSubjectAverage(parsed, composition.noteCount)
              const isSaving = saving[student.id]

              return (
                <tr key={student.id} className="border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {student.lastName} {student.firstName}
                  </td>
                  {Array.from({ length: composition.noteCount }, (_, ni) => (
                    <td key={ni} className="px-3 py-2">
                      <input
                        ref={el => { inputRefs.current[`${student.id}-${ni}`] = el }}
                        type="number"
                        min="0" max={composition.maxGrade ?? 20} step="0.25"
                        className={`w-full border rounded-lg px-2 py-1.5 text-center text-sm font-mono focus:outline-none focus:ring-2 transition-colors ${
                          (() => { const v = parseFloat(notes[ni] ?? ''); return !isNaN(v) && v > (composition.maxGrade ?? 20) })()
                            ? 'border-red-400 bg-red-50 text-red-600 focus:ring-red-200'
                            : 'border-slate-200 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF]'
                        }`}
                        value={notes[ni] ?? ''}
                        onChange={e => setNote(student.id, ni, e.target.value)}
                        onBlur={() => saveGrade(student.id)}
                        onKeyDown={e => handleKeyDown(e, si, ni)}
                        placeholder="—"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center">
                    <span className={`font-mono font-semibold text-sm ${avg !== null ? (avg >= 10 ? 'text-emerald-600' : 'text-red-600') : 'text-slate-400'}`}>
                      {fmt2(avg)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {isSaving && <div className="w-3.5 h-3.5 border-2 border-[#00D1FF] border-t-transparent rounded-full animate-spin mx-auto" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {activeStudents.length > 0 && classAvg !== null && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Moyenne classe</td>
                {Array.from({ length: composition.noteCount }, (_, i) => (
                  <td key={i} className="px-3 py-3 text-center text-xs text-slate-400">—</td>
                ))}
                <td className="px-4 py-3 text-center">
                  <span className="font-mono font-bold text-slate-900">{fmt2(classAvg)}/{composition.maxGrade ?? 20}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
