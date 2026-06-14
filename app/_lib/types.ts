export interface SchoolYear {
  id: string
  startDay: number
  startMonth: number
  startYear: number
  endDay: number
  endMonth: number
  endYear: number
  monthlyFee: number
  isActive: boolean
  createdAt: string
}

export interface SchoolSettings {
  name: string
  address: string
  phone: string
  email?: string
  website?: string
}

export interface Fee {
  id: string
  name: string
  monthlyAmount: number
  isDefault: boolean
  schoolYearId: string
}

export interface SchoolClass {
  id: string
  name: string
  schoolYearId: string
}

export interface Subject {
  id: string
  name: string
}

export interface Family {
  id: string
  name: string
  contacts: Contact[]
  schoolYearId: string
}

export interface Contact {
  name: string
  phone: string
  dialCode: string
  relation: string
}

export interface Student {
  id: string
  firstName: string
  lastName: string
  gender: 'M' | 'F'
  birthDate?: string
  classId: string
  familyId?: string
  contacts?: Contact[]
  isActive: boolean
  schoolYearId: string
  appliedFees: AppliedFee[]
}

export interface AppliedFee {
  feeId: string
  reduction: number
}

export interface MonthlyEntryFee {
  feeId: string
  feeName: string
  amount: number      // montant brut du frais
  reduction: number   // réduction individuelle
  due: number         // amount - reduction
  paid: number        // déjà versé
  balance: number     // due - paid
}

export interface MonthlyEntry {
  id: string
  studentId: string
  schoolYearId: string
  month: number       // 1–12
  year: number
  isActive: boolean
  fees: MonthlyEntryFee[]
  totalDue: number
  totalPaid: number
  totalBalance: number
  generatedAt: string
}

export interface PaymentAllocation {
  monthlyEntryId: string
  studentId: string
  feeId: string
  feeName: string
  month: number
  year: number
  amount: number
}

export interface Payment {
  id: string
  schoolYearId: string
  studentId: string
  familyId: string | null
  totalAmount: number
  date: string
  note: string | null
  allocations: PaymentAllocation[]
  createdAt: string
}

export interface Composition {
  id: string
  name: string
  schoolYearId: string
  noteCount: number
  noteNames: string[]
  maxGrade: number          // base de notation (ex: 20, 10, 100)
  classIds: string[]
  coefficients: Record<string, Record<string, number>>
  // classId -> array of studentIds excluded from this composition
  excludedStudents?: Record<string, string[]>
  createdAt: string
}

export interface WhatsappResult {
  name: string
  phones: string[]
  status: 'sent' | 'failed' | 'no_phone'
  error?: string
  studentIds: string[]
  familyId?: string
}

export interface WhatsappCampaign {
  id: string
  createdAt: string
  periodLabel: string
  schoolYearId: string
  userId: string
  results: WhatsappResult[]
  sentCount: number
  failedCount: number
  noPhoneCount: number
}

export interface Grade {
  id: string
  compositionId: string
  schoolYearId: string
  studentId: string
  classId: string
  subjectId: string
  notes: (number | null)[]
  average: number | null
  updatedAt: string
}
