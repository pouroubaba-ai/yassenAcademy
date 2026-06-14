'use client'

import { useState, useRef, useEffect } from 'react'

export const DIAL_CODES = [
  { code: '+242', country: 'Congo', flag: '🇨🇬' },
  { code: '+243', country: 'RD Congo', flag: '🇨🇩' },
  { code: '+241', country: 'Gabon', flag: '🇬🇦' },
  { code: '+237', country: 'Cameroun', flag: '🇨🇲' },
  { code: '+236', country: 'Centrafrique', flag: '🇨🇫' },
  { code: '+240', country: 'Guinée Éq.', flag: '🇬🇶' },
  { code: '+235', country: 'Tchad', flag: '🇹🇩' },
  { code: '+225', country: "Côte d'Ivoire", flag: '🇨🇮' },
  { code: '+221', country: 'Sénégal', flag: '🇸🇳' },
  { code: '+223', country: 'Mali', flag: '🇲🇱' },
  { code: '+226', country: 'Burkina Faso', flag: '🇧🇫' },
  { code: '+227', country: 'Niger', flag: '🇳🇪' },
  { code: '+228', country: 'Togo', flag: '🇹🇬' },
  { code: '+229', country: 'Bénin', flag: '🇧🇯' },
  { code: '+224', country: 'Guinée', flag: '🇬🇳' },
  { code: '+245', country: 'Guinée-Bissau', flag: '🇬🇼' },
  { code: '+238', country: 'Cap-Vert', flag: '🇨🇻' },
  { code: '+239', country: 'São Tomé', flag: '🇸🇹' },
  { code: '+222', country: 'Mauritanie', flag: '🇲🇷' },
  { code: '+212', country: 'Maroc', flag: '🇲🇦' },
  { code: '+213', country: 'Algérie', flag: '🇩🇿' },
  { code: '+216', country: 'Tunisie', flag: '🇹🇳' },
  { code: '+218', country: 'Libye', flag: '🇱🇾' },
  { code: '+20', country: 'Égypte', flag: '🇪🇬' },
  { code: '+249', country: 'Soudan', flag: '🇸🇩' },
  { code: '+251', country: 'Éthiopie', flag: '🇪🇹' },
  { code: '+254', country: 'Kenya', flag: '🇰🇪' },
  { code: '+255', country: 'Tanzanie', flag: '🇹🇿' },
  { code: '+256', country: 'Ouganda', flag: '🇺🇬' },
  { code: '+260', country: 'Zambie', flag: '🇿🇲' },
  { code: '+263', country: 'Zimbabwe', flag: '🇿🇼' },
  { code: '+264', country: 'Namibie', flag: '🇳🇦' },
  { code: '+265', country: 'Malawi', flag: '🇲🇼' },
  { code: '+266', country: 'Lesotho', flag: '🇱🇸' },
  { code: '+267', country: 'Botswana', flag: '🇧🇼' },
  { code: '+268', country: 'Eswatini', flag: '🇸🇿' },
  { code: '+27', country: 'Afrique du Sud', flag: '🇿🇦' },
  { code: '+233', country: 'Ghana', flag: '🇬🇭' },
  { code: '+234', country: 'Nigeria', flag: '🇳🇬' },
  { code: '+250', country: 'Rwanda', flag: '🇷🇼' },
  { code: '+257', country: 'Burundi', flag: '🇧🇮' },
  { code: '+258', country: 'Mozambique', flag: '🇲🇿' },
  { code: '+261', country: 'Madagascar', flag: '🇲🇬' },
  { code: '+269', country: 'Comores', flag: '🇰🇲' },
  { code: '+230', country: 'Maurice', flag: '🇲🇺' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+32', country: 'Belgique', flag: '🇧🇪' },
  { code: '+41', country: 'Suisse', flag: '🇨🇭' },
  { code: '+1', country: 'USA / Canada', flag: '🇺🇸' },
  { code: '+44', country: 'Royaume-Uni', flag: '🇬🇧' },
  { code: '+49', country: 'Allemagne', flag: '🇩🇪' },
  { code: '+34', country: 'Espagne', flag: '🇪🇸' },
  { code: '+39', country: 'Italie', flag: '🇮🇹' },
  { code: '+351', country: 'Portugal', flag: '🇵🇹' },
]

export function buildFullPhone(dialCode: string, phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const dc = dialCode.startsWith('+') ? dialCode : `+${dialCode}`
  return `${dc}${digits}`
}

interface Props {
  dialCode: string
  phone: string
  onDialCodeChange: (v: string) => void
  onPhoneChange: (v: string) => void
  placeholder?: string
  className?: string
}

export default function PhoneInput({ dialCode, phone, onDialCodeChange, onPhoneChange, placeholder = '06 000 000', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = search.trim()
    ? DIAL_CODES.filter(d =>
        d.country.toLowerCase().includes(search.toLowerCase()) ||
        d.code.includes(search)
      )
    : DIAL_CODES

  const selected = DIAL_CODES.find(d => d.code === dialCode) ?? DIAL_CODES[0]

  return (
    <div ref={ref} className={`flex gap-1 ${className}`}>
      {/* Dial code selector */}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setOpen(!open); setSearch('') }}
          className="flex items-center gap-1 px-2 py-2 rounded-xl border border-slate-200 bg-white text-sm hover:border-slate-300 transition-colors whitespace-nowrap h-full"
        >
          <span>{selected.flag}</span>
          <span className="text-slate-600 text-xs font-medium">{selected.code}</span>
          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg w-56 max-h-64 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-slate-100">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
              />
            </div>
            <div className="overflow-y-auto">
              {filtered.map(d => (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => { onDialCodeChange(d.code); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${dialCode === d.code ? 'bg-[#00D1FF]/5 text-[#00D1FF] font-medium' : 'text-slate-700'}`}
                >
                  <span>{d.flag}</span>
                  <span className="flex-1 text-left">{d.country}</span>
                  <span className="text-slate-400 text-xs">{d.code}</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Aucun résultat</p>}
            </div>
          </div>
        )}
      </div>

      {/* Phone number input */}
      <input
        type="tel"
        value={phone}
        onChange={e => onPhoneChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-2.5 py-2 rounded-xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#00D1FF]"
      />
    </div>
  )
}
