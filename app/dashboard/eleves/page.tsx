'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../_lib/firebase'
import { useSchoolYear } from '../../_lib/school-year-context'
import { Student, SchoolClass, Family, Fee } from '../../_lib/types'
import AddStudentModal from './_components/AddStudentModal'
import AddFamilyModal from './_components/AddFamilyModal'

type Tab = 'eleves' | 'familles'

export default function ElevesPage() {
  const { activeYear, allYears, uid } = useSchoolYear()
  const [selectedYearId, setSelectedYearId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('eleves')
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [families, setFamilies] = useState<Family[]>([])
  const [fees, setFees] = useState<Fee[]>([])
  const [search, setSearch] = useState('')
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showAddFamily, setShowAddFamily] = useState(false)
  const [filterActive, setFilterActive] = useState(true)
  const [filterGender, setFilterGender] = useState<'M' | 'F' | ''>('')
  const [filterClassId, setFilterClassId] = useState('')

  const displayYearId = selectedYearId || activeYear?.id || ''

  useEffect(() => {
    if (!displayYearId || !uid) return
    const qs = query(collection(db, 'students'), where('schoolYearId', '==', displayYearId), where('userId', '==', uid))
    const qc = query(collection(db, 'classes'), where('schoolYearId', '==', displayYearId), where('userId', '==', uid))
    const qf = query(collection(db, 'families'), where('schoolYearId', '==', displayYearId), where('userId', '==', uid))
    const qfees = query(collection(db, 'fees'), where('schoolYearId', '==', displayYearId), where('userId', '==', uid))
    const u1 = onSnapshot(qs, (s) => setStudents(s.docs.map((d) => ({ id: d.id, ...d.data() } as Student))))
    const u2 = onSnapshot(qc, (s) => setClasses(s.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolClass))))
    const u3 = onSnapshot(qf, (s) => setFamilies(s.docs.map((d) => ({ id: d.id, ...d.data() } as Family))))
    const u4 = onSnapshot(qfees, (s) => setFees(s.docs.map((d) => ({ id: d.id, ...d.data() } as Fee))))
    return () => { u1(); u2(); u3(); u4() }
  }, [displayYearId, uid])

  const activeStudents = students.filter((s) => s.isActive)
  const inactiveStudents = students.filter((s) => !s.isActive)

  const displayedStudents = useMemo(() => {
    let list = filterActive ? activeStudents : students
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q))
    }
    if (filterGender) list = list.filter((s) => s.gender === filterGender)
    if (filterClassId) list = list.filter((s) => s.classId === filterClassId)
    return list
  }, [students, activeStudents, filterActive, search, filterGender, filterClassId])

  const displayedFamilies = useMemo(() => {
    if (!search.trim() || tab !== 'familles') return families
    const q = search.toLowerCase()
    return families.filter((f) => f.name.toLowerCase().includes(q))
  }, [families, search, tab])

  const studentsInFamily = (familyId: string) => students.filter((s) => s.familyId === familyId)
  const activeInFamily = (familyId: string) => students.filter((s) => s.familyId === familyId && s.isActive)
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]))

  function getAge(birthDate?: string) {
    if (!birthDate) return '—'
    const diff = Date.now() - new Date(birthDate).getTime()
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)) + ' ans'
  }

  const totalBoys = activeStudents.filter((s) => s.gender === 'M').length
  const totalGirls = activeStudents.filter((s) => s.gender === 'F').length
  const familiesWithStudents = families.filter((f) => activeInFamily(f.id).length > 0)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestion des Élèves</h1>
          <p className="text-slate-500 text-sm mt-1">Vue d'ensemble de vos élèves et familles</p>
        </div>
        {/* Year filter */}
        <select
          value={selectedYearId}
          onChange={(e) => setSelectedYearId(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
        >
          <option value="">Année en cours</option>
          {allYears.map((y) => (
            <option key={y.id} value={y.id}>
              {y.startYear}/{y.endYear}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Élèves actifs</p>
          <p className="text-2xl font-bold text-slate-900">{activeStudents.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">{totalBoys} G · {totalGirls} F</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Familles</p>
          <p className="text-2xl font-bold text-slate-900">{familiesWithStudents.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {familiesWithStudents.reduce((acc, f) => acc + activeInFamily(f.id).length, 0)} élèves
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Classes</p>
          <p className="text-2xl font-bold text-slate-900">{classes.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Inactifs</p>
          <p className="text-2xl font-bold text-slate-900">{inactiveStudents.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-slate-100 p-1 w-fit mb-5">
        {(['eleves', 'familles'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'eleves' ? 'Élèves' : 'Familles'}
          </button>
        ))}
      </div>

      {/* Search + actions bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'eleves' ? 'Rechercher un élève…' : 'Rechercher une famille…'}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
          />
        </div>
        {tab === 'eleves' && (
          <>
            <button
              onClick={() => setFilterActive(!filterActive)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                filterActive
                  ? 'bg-[#00D1FF]/10 border-[#00D1FF]/30 text-[#00D1FF]'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {filterActive ? 'Actifs' : 'Tous'}
            </button>

            {/* Filtre sexe */}
            <div className="flex rounded-xl bg-slate-100 p-0.5 gap-0.5">
              {([['', 'Tous'], ['M', 'Garçons'], ['F', 'Filles']] as [string, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFilterGender(val as 'M' | 'F' | '')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                    filterGender === val
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Filtre classe */}
            <select
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className={`px-3 py-2.5 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#00D1FF] ${
                filterClassId
                  ? 'border-[#00D1FF]/30 bg-[#00D1FF]/5 text-[#00D1FF]'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              <option value="">Toutes les classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Bouton reset filtres si actifs */}
            {(filterGender || filterClassId) && (
              <button
                onClick={() => { setFilterGender(''); setFilterClassId('') }}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2 py-2.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Réinitialiser
              </button>
            )}
          </>
        )}
        <div className="ml-auto">
          {tab === 'eleves' ? (
            <button
              onClick={() => setShowAddStudent(true)}
              className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ajouter un élève
            </button>
          ) : (
            <button
              onClick={() => setShowAddFamily(true)}
              className="bg-[#00D1FF] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:bg-[#00b8e0] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ajouter une famille
            </button>
          )}
        </div>
      </div>

      {/* Students table */}
      {tab === 'eleves' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Élève</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Classe</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sexe</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Âge</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayedStudents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400 text-sm">
                    Aucun élève trouvé.
                  </td>
                </tr>
              ) : (
                displayedStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          student.gender === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
                        }`}>
                          {student.firstName[0]}{student.lastName[0]}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{student.firstName} {student.lastName}</p>
                          {!student.isActive && (
                            <span className="text-xs text-slate-400">Inactif</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{classMap[student.classId] || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-600">{student.gender === 'M' ? 'Garçon' : 'Fille'}</td>
                    <td className="px-5 py-3.5 text-slate-600">{getAge(student.birthDate)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/dashboard/eleves/${student.id}`}
                        className="text-[#00D1FF] text-xs font-medium hover:underline"
                      >
                        Voir la fiche
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Families table */}
      {tab === 'familles' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Famille</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Enfants</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actifs</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Inactifs</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayedFamilies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400 text-sm">Aucune famille trouvée.</td>
                </tr>
              ) : (
                displayedFamilies.map((family) => {
                  const all = studentsInFamily(family.id)
                  const active = activeInFamily(family.id)
                  return (
                    <tr key={family.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-slate-900">{family.name}</td>
                      <td className="px-5 py-3.5 text-slate-600">{all.length}</td>
                      <td className="px-5 py-3.5 text-slate-600">{active.length}</td>
                      <td className="px-5 py-3.5 text-slate-600">{all.length - active.length}</td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/dashboard/eleves/famille/${family.id}`}
                          className="text-[#00D1FF] text-xs font-medium hover:underline"
                        >
                          Voir la fiche
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAddStudent && (
        <AddStudentModal
          classes={classes}
          families={families}
          fees={fees}
          students={students}
          schoolYearId={displayYearId}
          uid={uid ?? ''}
          onClose={() => setShowAddStudent(false)}
        />
      )}
      {showAddFamily && (
        <AddFamilyModal
          schoolYearId={displayYearId}
          uid={uid ?? ''}
          onClose={() => setShowAddFamily(false)}
        />
      )}
    </div>
  )
}
