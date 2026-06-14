'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { collection, query, where, onSnapshot, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { Composition, SchoolClass, Subject, Student, Grade } from '../../_lib/types'
import { getCompositionStatus, statusLabel, statusClass } from '../../_lib/grade-utils'

type CoeffMode = 'uniform' | 'per_subject' | 'per_class'

export default function PedagogiePage() {
  const { activeYear, uid } = useSchoolYear()
  const router = useRouter()

  const [compositions, setCompositions] = useState<Composition[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!activeYear?.id || !uid) return
    const yid = activeYear.id

    const u1 = onSnapshot(
      query(collection(db, 'compositions'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setCompositions(s.docs.map(d => ({ id: d.id, ...d.data() } as Composition)))
    )
    const u2 = onSnapshot(
      query(collection(db, 'classes'), where('schoolYearId', '==', yid), where('userId', '==', uid)),
      s => setClasses(s.docs.map(d => ({ id: d.id, ...d.data() } as SchoolClass)))
    )
    const u3 = onSnapshot(query(collection(db, 'subjects'), where('userId', '==', uid)),
      s => setSubjects(s.docs.map(d => ({ id: d.id, ...d.data() } as Subject)))
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

  const studentsByClass = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const s of students) {
      if (!map[s.classId]) map[s.classId] = []
      map[s.classId].push(s.id)
    }
    return map
  }, [students])

  async function handleDelete(comp: Composition) {
    if (!confirm(`Supprimer "${comp.name}" et toutes ses notes ?`)) return
    setDeleting(comp.id)
    // delete all grades for this composition
    const snap = await getDocs(query(collection(db, 'grades'), where('compositionId', '==', comp.id)))
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'grades', d.id))))
    await deleteDoc(doc(db, 'compositions', comp.id))
    setDeleting(null)
  }

  const sorted = [...compositions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Compositions</h1>
          <p className="text-slate-500 text-sm mt-1">Gérez les évaluations et la saisie des notes</p>
        </div>
        {activeYear && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl font-semibold text-sm shadow-sm hover:bg-[#00b8e0] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nouvelle composition
          </button>
        )}
      </div>

      {!activeYear && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center text-slate-500">
          Aucune année scolaire active.
        </div>
      )}

      {activeYear && sorted.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="w-14 h-14 bg-[#00D1FF]/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#00D1FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="font-semibold text-slate-900 mb-1">Aucune composition</p>
          <p className="text-slate-500 text-sm mb-6">Créez votre première composition pour commencer la saisie des notes.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#00D1FF] text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#00b8e0] transition-colors"
          >
            Créer une composition
          </button>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="grid gap-4">
          {sorted.map(comp => {
            const status = getCompositionStatus(comp, grades, studentsByClass)
            const classNames = comp.classIds.map(cid => classes.find(c => c.id === cid)?.name ?? '—').join(', ')
            const subjectCount = new Set(
              comp.classIds.flatMap(cid => Object.keys(comp.coefficients[cid] ?? {}))
            ).size
            return (
              <div key={comp.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="font-semibold text-slate-900 text-base truncate">{comp.name}</h2>
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full flex-shrink-0 ${statusClass(status)}`}>
                      {statusLabel(status)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">
                    {comp.noteCount} note{comp.noteCount > 1 ? 's' : ''} · {subjectCount} matière{subjectCount > 1 ? 's' : ''} · {classNames || 'Aucune classe'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => router.push(`/dashboard/pedagogie/${comp.id}`)}
                    className="px-4 py-2 bg-slate-50 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors"
                  >
                    Ouvrir
                  </button>
                  <button
                    onClick={() => handleDelete(comp)}
                    disabled={deleting === comp.id}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateCompositionModal
          classes={classes}
          subjects={subjects}
          schoolYearId={activeYear?.id ?? ''}
          uid={uid ?? ''}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}

function CreateCompositionModal({
  classes, subjects, schoolYearId, uid, onClose,
}: {
  classes: SchoolClass[]
  subjects: Subject[]
  schoolYearId: string
  uid: string
  onClose: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState('')
  const [noteCount, setNoteCount] = useState(2)
  const [noteNames, setNoteNames] = useState<string[]>(['Note 1', 'Note 2'])
  const [maxGrade, setMaxGrade] = useState(20)
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [coeffMode, setCoeffMode] = useState<CoeffMode>('per_subject')
  // coefficients[classId][subjectId] or per_subject: uniformClassId='__all__'
  const [coefficients, setCoefficients] = useState<Record<string, Record<string, number>>>({})
  const [saving, setSaving] = useState(false)

  // Sync noteNames length with noteCount
  function handleNoteCount(n: number) {
    const clamped = Math.max(1, Math.min(10, n))
    setNoteCount(clamped)
    setNoteNames(prev => {
      const next = [...prev]
      while (next.length < clamped) next.push(`Note ${next.length + 1}`)
      return next.slice(0, clamped)
    })
  }

  // When classes change, init coefficients for new classes
  function toggleClass(cid: string) {
    setSelectedClasses(prev => {
      const next = prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
      // init coefficients for newly added classes
      if (!prev.includes(cid)) {
        setCoefficients(c => {
          if (c[cid]) return c
          const subCoeffs: Record<string, number> = {}
          subjects.forEach(s => { subCoeffs[s.id] = 1 })
          return { ...c, [cid]: subCoeffs }
        })
      }
      return next
    })
  }

  function initCoefficientsForStep3() {
    const next: Record<string, Record<string, number>> = {}
    for (const cid of selectedClasses) {
      next[cid] = {}
      for (const sub of subjects) {
        next[cid][sub.id] = coefficients[cid]?.[sub.id] ?? 1
      }
    }
    setCoefficients(next)
  }

  function setCoeff(classId: string, subjectId: string, val: number) {
    setCoefficients(prev => ({
      ...prev,
      [classId]: { ...prev[classId], [subjectId]: val },
    }))
  }

  function setCoeffUniform(val: number) {
    setCoefficients(prev => {
      const next = { ...prev }
      for (const cid of selectedClasses) {
        next[cid] = {}
        for (const sub of subjects) {
          next[cid][sub.id] = val
        }
      }
      return next
    })
  }

  function setCoeffPerSubject(subjectId: string, val: number) {
    setCoefficients(prev => {
      const next = { ...prev }
      for (const cid of selectedClasses) {
        next[cid] = { ...next[cid], [subjectId]: val }
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await addDoc(collection(db, 'compositions'), {
        name: name.trim(),
        schoolYearId,
        userId: uid,
        noteCount,
        noteNames,
        maxGrade,
        classIds: selectedClasses,
        coefficients,
        createdAt: new Date().toISOString(),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const canNext1 = name.trim().length > 0 && noteCount >= 1
  const canNext2 = selectedClasses.length > 0

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Nouvelle composition</h2>
            <p className="text-sm text-slate-500">Étape {step} sur 3</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="px-6 pt-4 flex gap-2">
          {[1,2,3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? 'bg-[#00D1FF]' : 'bg-slate-100'}`} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Nom de la composition</label>
                <input
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF]"
                  placeholder="Ex: Composition 1, Examen Semestriel..."
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre de notes par matière</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleNoteCount(noteCount - 1)}
                    className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <span className="text-2xl font-bold text-slate-900 w-8 text-center">{noteCount}</span>
                  <button
                    onClick={() => handleNoteCount(noteCount + 1)}
                    className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Noms des colonnes de notes</label>
                <div className="space-y-2">
                  {noteNames.map((n, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-sm text-slate-400 w-16">Note {i + 1}</span>
                      <input
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF]"
                        value={n}
                        onChange={e => setNoteNames(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Base de notation
                  <span className="ml-2 text-xs font-normal text-slate-400">Sur combien les notes sont saisies</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1" max="1000" step="1"
                    className="w-28 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF] text-center font-mono"
                    value={maxGrade}
                    onChange={e => setMaxGrade(Math.max(1, parseInt(e.target.value) || 20))}
                  />
                  <span className="text-sm text-slate-500">points</span>
                  {[10, 20, 100].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMaxGrade(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        maxGrade === v
                          ? 'bg-[#00D1FF]/10 border-[#00D1FF] text-[#00D1FF]'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      /{v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-sm text-slate-500 mb-4">Sélectionnez les classes concernées par cette composition.</p>
              {classes.length === 0 && (
                <p className="text-sm text-slate-400 italic">Aucune classe disponible.</p>
              )}
              <div className="space-y-2">
                {classes.map(cls => (
                  <label key={cls.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedClasses.includes(cls.id)}
                      onChange={() => toggleClass(cls.id)}
                      className="w-4 h-4 accent-[#00D1FF]"
                    />
                    <span className="text-sm font-medium text-slate-900">{cls.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Mode de saisie des coefficients</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['uniform', 'Uniforme', 'Un seul coefficient pour tout'],
                    ['per_subject', 'Par matière', 'Un coefficient par matière'],
                    ['per_class', 'Par classe', 'Différent selon la classe'],
                  ] as [CoeffMode, string, string][]).map(([mode, label, desc]) => (
                    <button
                      key={mode}
                      onClick={() => setCoeffMode(mode)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        coeffMode === mode ? 'border-[#00D1FF] bg-[#00D1FF]/5' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {coeffMode === 'uniform' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Coefficient unique</label>
                  <input
                    type="number" min="0.5" max="10" step="0.5"
                    className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF]"
                    defaultValue="1"
                    onChange={e => setCoeffUniform(parseFloat(e.target.value) || 1)}
                  />
                </div>
              )}

              {coeffMode === 'per_subject' && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Coefficient par matière</p>
                  <div className="space-y-2">
                    {subjects.map(sub => (
                      <div key={sub.id} className="flex items-center gap-3">
                        <span className="text-sm text-slate-700 flex-1">{sub.name}</span>
                        <input
                          type="number" min="0.5" max="10" step="0.5"
                          className="w-24 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF] text-center"
                          value={coefficients[selectedClasses[0]]?.[sub.id] ?? 1}
                          onChange={e => setCoeffPerSubject(sub.id, parseFloat(e.target.value) || 1)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {coeffMode === 'per_class' && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left text-xs font-semibold text-slate-500 pb-2 pr-4">Matière</th>
                          {selectedClasses.map(cid => (
                            <th key={cid} className="text-center text-xs font-semibold text-slate-500 pb-2 px-2">
                              {classes.find(c => c.id === cid)?.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="space-y-1">
                        {subjects.map(sub => (
                          <tr key={sub.id} className="border-t border-slate-100">
                            <td className="py-2 pr-4 text-slate-700">{sub.name}</td>
                            {selectedClasses.map(cid => (
                              <td key={cid} className="py-2 px-2 text-center">
                                <input
                                  type="number" min="0.5" max="10" step="0.5"
                                  className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#00D1FF]/30 focus:border-[#00D1FF]"
                                  value={coefficients[cid]?.[sub.id] ?? 1}
                                  onChange={e => setCoeff(cid, sub.id, parseFloat(e.target.value) || 1)}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between">
          <button
            onClick={() => step === 1 ? onClose() : setStep(s => (s - 1) as 1 | 2 | 3)}
            className="px-4 py-2 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
          >
            {step === 1 ? 'Annuler' : 'Retour'}
          </button>
          {step < 3 ? (
            <button
              onClick={() => {
                if (step === 2) initCoefficientsForStep3()
                setStep(s => (s + 1) as 2 | 3)
              }}
              disabled={step === 1 ? !canNext1 : !canNext2}
              className="px-5 py-2 bg-[#00D1FF] text-white text-sm font-semibold rounded-xl hover:bg-[#00b8e0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivant
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-[#00D1FF] text-white text-sm font-semibold rounded-xl hover:bg-[#00b8e0] transition-colors disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Créer la composition'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
