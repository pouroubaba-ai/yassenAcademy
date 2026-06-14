'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { signOut } from 'firebase/auth'
import { auth } from '../_lib/firebase'
import { useAuth } from '../_lib/auth-context'
import { useSchoolYear } from '../_lib/school-year-context'

const pedagogyHrefs = ['/dashboard/pedagogie', '/dashboard/pedagogie/moyennes', '/dashboard/pedagogie/tableau-de-bord', '/dashboard/matieres']

type NavItem = { href: string; label: string; icon: React.ReactNode }
type NavGroup = { label: string | null; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      {
        href: '/dashboard',
        label: 'Tableau de bord',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        href: '/dashboard/eleves',
        label: 'Élèves',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/classes',
        label: 'Classes',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
      },
      {
        href: '/dashboard/frais',
        label: 'Frais',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/matieres',
        label: 'Matières',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ),
      },
      {
        href: '/dashboard/migration',
        label: 'Migration',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        ),
      },
      {
        href: '/dashboard/parametres',
        label: 'Paramètres',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        href: '/dashboard/finance',
        label: 'Suivi financier',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/finance/versements',
        label: 'Versements',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/finance/tableau-de-bord',
        label: 'Tableau de bord',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/finance/avis',
        label: 'Avis de paiement',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Pédagogie',
    items: [
      {
        href: '/dashboard/pedagogie',
        label: 'Compositions',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        ),
      },
      {
        href: '/dashboard/pedagogie/moyennes',
        label: 'Moyennes annuelles',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/pedagogie/tableau-de-bord',
        label: 'Tableau de bord',
        icon: (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
        ),
      },
    ],
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, secretary, logoutSecretary } = useAuth()
  const { activeYear } = useSchoolYear()
  const router = useRouter()
  const pathname = usePathname()

  // Desktop: collapsed sidebar (icons only)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-collapsed') === 'true'
    }
    return false
  })

  // Mobile: open/close drawer
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Persist collapsed state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebar-collapsed', String(collapsed))
    }
  }, [collapsed])

  // Close mobile menu on outside click
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loading && !user && !secretary) router.replace('/login')
  }, [user, loading, secretary, router])

  if (loading || (!user && !secretary)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#00D1FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const visibleNavGroups = secretary
    ? navGroups
        .map((g) => ({ ...g, items: g.items.filter((i) => pedagogyHrefs.includes(i.href)) }))
        .filter((g) => g.items.length > 0)
    : navGroups

  const SidebarContent = ({ onNav }: { onNav?: () => void }) => (
    <>
      {/* Logo */}
      <div className={`border-b border-slate-100 flex items-center justify-between ${collapsed ? 'px-3 py-4' : 'px-5 py-4'}`}>
        <div className={`flex items-center gap-3 min-w-0 ${collapsed ? 'justify-center w-full' : ''}`}>
          <div className="w-9 h-9 rounded-xl bg-[#00D1FF] flex items-center justify-center shadow-sm flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-bold text-slate-900 text-sm leading-tight truncate">Yassen Academy</p>
              {secretary && <p className="text-xs text-violet-500 leading-tight font-medium">Secrétaire</p>}
              {activeYear && !secretary && (
                <p className="text-xs text-slate-400 leading-tight">{activeYear.startYear}/{activeYear.endYear}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-4 overflow-y-auto">
        {visibleNavGroups.map((group, gi) => (
          <div key={gi}>
            {group.label && !collapsed && (
              <p className="px-3 mb-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {group.label}
              </p>
            )}
            {group.label && collapsed && (
              <div className="my-2 mx-3 h-px bg-slate-100" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href)
                return (
                  <div key={item.href} className="relative group/navitem">
                    <Link
                      href={item.href}
                      onClick={onNav}
                      className={`flex items-center gap-3 rounded-xl text-sm font-medium transition-all
                        ${collapsed ? 'justify-center px-0 py-2.5 mx-1' : 'px-3 py-2.5'}
                        ${isActive
                          ? 'bg-[#00D1FF]/10 text-[#00D1FF]'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                    >
                      <span className={isActive ? 'text-[#00D1FF]' : 'text-slate-400'}>{item.icon}</span>
                      {!collapsed && item.label}
                    </Link>
                    {/* Tooltip when collapsed — desktop only */}
                    {collapsed && (
                      <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                        opacity-0 group-hover/navitem:opacity-100 transition-opacity duration-150">
                        <div className="bg-slate-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                          {item.label}
                          {/* Arrow */}
                          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div className={`border-t border-slate-100 ${collapsed ? 'px-2 py-3' : 'px-2 py-3'}`}>
        {secretary && !collapsed && (
          <p className="px-3 py-1.5 text-xs text-slate-400 truncate">{secretary.name}</p>
        )}
        <div className="relative group/logout">
          <button
            onClick={() => secretary ? (logoutSecretary(), router.replace('/login')) : signOut(auth)}
            className={`flex items-center gap-3 w-full rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all
              ${collapsed ? 'justify-center px-0 py-2.5 mx-1' : 'px-3 py-2.5'}`}
          >
            <svg className="w-5 h-5 flex-shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!collapsed && 'Déconnexion'}
          </button>
          {collapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
              opacity-0 group-hover/logout:opacity-100 transition-opacity duration-150">
              <div className="bg-slate-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                Déconnexion
                <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
              </div>
            </div>
          )}
        </div>

        {/* Desktop collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`hidden md:flex items-center gap-2 w-full mt-1 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all
            ${collapsed ? 'justify-center px-0 py-2 mx-1' : 'px-3 py-2'}`}
          title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
        >
          <svg className={`w-4 h-4 flex-shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          {!collapsed && <span>Réduire</span>}
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex bg-slate-50">

      {/* ── Desktop sidebar ── */}
      <aside className={`hidden md:flex flex-col bg-white border-r border-slate-100 shadow-sm flex-shrink-0 transition-all duration-300 ${collapsed ? 'w-[68px]' : 'w-64'}`}>
        <SidebarContent />
      </aside>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          ref={overlayRef}
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside className={`fixed top-0 left-0 h-full w-72 bg-white shadow-xl z-50 flex flex-col transition-transform duration-300 md:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <SidebarContent onNav={() => setMobileOpen(false)} />
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100 shadow-sm sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#00D1FF] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="font-bold text-slate-900 text-sm">Yassen Academy</span>
          </div>
          {activeYear && (
            <span className="ml-auto text-xs text-slate-400">{activeYear.startYear}/{activeYear.endYear}</span>
          )}
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
