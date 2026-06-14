# RESUME_PROJET — Yassen Academy
> Fichier de mémoire projet. Mis à jour à chaque modification significative.
> Dernière mise à jour : 2026-06-10 — Module Finance enrichi (annulation versements, factures pro, mois futurs, colonne réductions, modales d'édition réductions)

---

## 1. Vue d'ensemble du projet

**Yassen Academy** est une application web de gestion scolaire construite avec **Next.js 16.2.7 (App Router)** et **Firebase (Firestore + Auth)**.

### Modules prévus

| Module | Statut | Description |
|---|---|---|
| **App** | ✅ En cours | Authentification, années scolaires, paramètres, frais, classes, matières, élèves, familles |
| **Finance** | 🔲 À faire | Suivi des paiements mensuels, tableau de bord financier |
| **Pédagogie** | 🔲 À faire | Emplois du temps, notes, bulletins |

### Stack technique
- **Next.js 16.2.7** — App Router, `params` est une `Promise<{...}>`, composants Server par défaut
- **React 19** — Server Components + Client Components (`'use client'`)
- **Firebase Firestore** — Base de données temps réel avec `onSnapshot`
- **Firebase Auth** — Authentification email/password
- **Tailwind CSS v4** — Syntaxe `@import "tailwindcss"` + `@theme inline`
- **TypeScript**

### Design system
- Couleur principale : `#00D1FF`
- Texte principal : `text-slate-900`
- Cartes : `rounded-xl shadow-sm border border-slate-100`
- Boutons primaires : `bg-[#00D1FF] text-white rounded-xl`
- Police : Inter

---

## 2. Structure des données (Firestore)

### Collection `schoolYears`
```
{
  id: string,
  startDay: number,
  startMonth: number,        // 1–12
  startYear: number,
  endDay: number,
  endMonth: number,
  endYear: number,
  monthlyFee: number,        // frais de scolarité par défaut
  isActive: boolean,
  createdAt: Timestamp
}
```

### Collection `fees`
```
{
  id: string,
  name: string,
  monthlyAmount: number,
  isDefault: boolean,        // true = scolarité de base (toujours appliquée)
  schoolYearId: string
}
```
> ⚠️ À la création d'une année scolaire, un frais "Scolarité" isDefault=true est automatiquement créé avec `monthlyAmount = schoolYear.monthlyFee`.

### Collection `classes`
```
{
  id: string,
  name: string,
  schoolYearId: string
}
```

### Collection `subjects`
```
{
  id: string,
  name: string
  // PAS de schoolYearId — les matières sont globales à l'établissement
}
```

### Collection `families`
```
{
  id: string,
  name: string,
  contacts: [
    { name: string, phone: string, relation: string }
  ],
  schoolYearId: string
}
```

### Collection `students`
```
{
  id: string,
  firstName: string,
  lastName: string,
  gender: 'M' | 'F',
  birthDate: string | null,   // ISO date string
  classId: string,
  familyId: string | null,
  isActive: boolean,
  schoolYearId: string,
  appliedFees: [
    { feeId: string, reduction: number }
  ]
}
```

### Document `settings/school`
```
{
  name: string,               // nom de l'établissement
  address: string,
  phone: string,
  currency: 'MAD' | 'XOF' | 'XAF' | 'EUR' | 'USD'
}
```

---

## 3. Architecture des fichiers

```
app/
├── layout.tsx                        # Root layout : AuthProvider > CurrencyProvider > SchoolYearProvider
├── page.tsx                          # Redirect → /dashboard ou /login
├── login/
│   └── page.tsx                      # Connexion / Inscription (tabs)
├── dashboard/
│   ├── layout.tsx                    # Sidebar navigation + guard auth
│   ├── page.tsx                      # Dashboard principal (stats + CreateSchoolYearModal)
│   ├── _components/
│   │   └── CreateSchoolYearModal.tsx
│   ├── parametres/
│   │   └── page.tsx                  # Infos école + devise + frais de scolarité éditables
│   ├── frais/
│   │   └── page.tsx                  # CRUD frais (FeeCard + AddFeeCard auto-contenus)
│   ├── classes/
│   │   └── page.tsx                  # CRUD classes (ClassCard + AddClassCard auto-contenus)
│   ├── matieres/
│   │   └── page.tsx                  # CRUD matières (SubjectCard + AddSubjectCard auto-contenus)
│   └── eleves/
│       ├── page.tsx                  # Liste élèves + familles (2 tabs)
│       ├── [id]/
│       │   └── page.tsx              # Fiche élève détaillée
│       ├── famille/
│       │   └── [id]/
│       │       └── page.tsx          # Fiche famille + gestion frais par élève
│       └── _components/
│           ├── AddStudentModal.tsx
│           └── AddFamilyModal.tsx
_lib/
├── firebase.ts                       # Init Firebase
├── types.ts                          # Interfaces TypeScript
├── auth-context.tsx                  # AuthProvider + useAuth()
├── school-year-context.tsx           # SchoolYearProvider + useSchoolYear()
└── currency-context.tsx              # CurrencyProvider + useCurrency()
```

---

## 4. Contextes globaux

### `useAuth()` → `{ user, loading }`
- `onAuthStateChanged` Firebase

### `useSchoolYear()` → `{ activeYear, allYears, loading }`
- `onSnapshot` sur collection `schoolYears`, triée par `startYear desc`
- `activeYear` = premier avec `isActive: true`

### `useCurrency()` → `{ currency, symbol, fmt }`
- Écoute `settings/school` en temps réel
- `fmt(n)` formate un montant avec le bon symbole
- Devises supportées : MAD (dh), XOF/XAF (FCFA), EUR (€), USD ($)

---

## 5. État d'avancement — Module App

| Fonctionnalité | Statut | Notes |
|---|---|---|
| Authentification (login/register) | ✅ Fait | Mapping messages erreurs Firebase en français |
| Création d'année scolaire | ✅ Fait | Valide que le mois de début ≥ mois courant |
| Paramètres école (nom, adresse, devise) | ✅ Fait | Sauvegardé dans `settings/school` |
| Frais de scolarité éditable dans paramètres | ✅ Fait | Met à jour `schoolYears.monthlyFee` ET `fees.monthlyAmount` du frais default |
| CRUD Frais optionnels | ✅ Fait | Composants `FeeCard`/`AddFeeCard` auto-contenus |
| CRUD Classes | ✅ Fait | Composants `ClassCard`/`AddClassCard` auto-contenus |
| CRUD Matières | ✅ Fait | Composants `SubjectCard`/`AddSubjectCard` auto-contenus |
| Liste élèves + recherche + filtres | ✅ Fait | Filtre par année, actifs/tous, recherche, **filtre sexe (Tous/Garçons/Filles)**, **filtre par classe** + bouton reset |
| Liste familles | ✅ Fait | Stats (enfants, actifs, inactifs) |
| Ajout d'un élève | ✅ Fait | Vérification doublon prénom+nom, héritage frais familiaux |
| Ajout d'une famille | ✅ Fait | Nom + contacts (nom, téléphone, relation) |
| Fiche élève détaillée | ✅ Fait | Toggle actif/inactif animé, frais avec réductions, assignation famille |
| Fiche famille | ✅ Fait | Frais par élève, toggle famille entière, modale partielle |
| Modale gestion frais partiels (famille) | ✅ Fait | Checkboxes par élève + "Appliquer à tous" / "Retirer de tous" |
| Module Finance — Suivi financier | ✅ Fait | Vue mensuelle/annuelle, filtres, stats, tooltips par frais, génération auto mensuelle |
| Module Finance — Versements | ✅ Fait | Recherche élève/famille, sélection frais, aperçu répartition, confirmation, historique, **annulation**, **mois futurs**, **reçu facture pro** |
| Module Finance — Tableau de bord | ✅ Fait | 7 KPIs (+ total réductions en amber), graphique évolution mensuelle, top débiteurs, taux recouvrement par classe |
| Module Finance — Réductions | ✅ Fait | Colonne Réductions dans suivi + crayon d'édition par élève/famille (vue mensuelle) + modales avec contrainte `new_reduction ≤ amount - paid` |
| Module Pédagogie | 🔲 À faire | — |

---

## 6. Règles métier clés

### Années scolaires
- Une seule année peut être `isActive: true` à la fois
- Le mois de début doit être ≥ au mois courant lors de la création
- À la création, un frais "Scolarité" `isDefault:true` est auto-créé

### Frais
- Les frais `isDefault:true` sont **toujours appliqués** à tous les élèves (non modifiables par élève)
- Les frais `isDefault:false` sont **optionnels** et peuvent être appliqués élève par élève ou famille entière
- Chaque frais appliqué peut avoir une **réduction** individuelle (montant soustrait, ≥ 0)
- Modifier le `monthlyFee` d'une année dans Paramètres **met aussi à jour** le `monthlyAmount` du frais scolarité default correspondant

### Élèves
- **Doublon interdit** : un élève ne peut pas être ajouté si un autre élève de la **même année** a exactement le même prénom ET le même nom (la casse est ignorée). Même prénom seul ou même nom seul est autorisé.
- Un élève peut être **désactivé** (toggle animé) sans être supprimé
- L'élève conserve ses frais même inactif

### Familles et héritage de frais
- Quand un élève est ajouté à une famille existante, il **hérite automatiquement** des frais optionnels appliqués à **TOUS** les membres actifs de cette famille, avec la réduction du premier membre comme valeur par défaut
- Le widget `FamilyFeeToggle` affiche 3 états :
  - **Bleu (all)** : le frais est appliqué à tous les membres
  - **Amber (some)** : le frais est partiellement appliqué → bouton "Partiel — gérer" ouvre une modale
  - **Vide (none)** : le frais n'est appliqué à personne

### Suppression d'une classe
- Si la classe contient des élèves, il faut choisir une **classe de destination** avant de supprimer
- Tous les élèves concernés sont déplacés vers la classe choisie

### Modales et formulaires — règle critique
- `setSaving(false)` doit être appelé **AVANT** `onClose()` / `onDone()`, jamais dans un bloc `finally`
- Raison : Firebase déclenche `onSnapshot` localement AVANT que la promesse `addDoc` soit résolue → le re-render intermédiaire voit `saving=true` et `showModal=true`, ce qui bloque la fermeture
- Les composants d'édition inline (FeeCard, ClassCard, SubjectCard) ont chacun leur **propre état** `saving`/`editing` pour éviter la contamination croisée lors des re-renders `onSnapshot`

---

## 7. Patterns techniques importants

### Composants auto-contenus (pattern validé)
```tsx
function ItemCard({ item, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateDoc(...)
      setSaving(false)   // ← AVANT setEditing(false)
      setEditing(false)
    } catch {
      setSaving(false)
    }
  }
  // ...
}
```

### Mise à jour optimiste
```tsx
// 1. Mettre à jour le state local immédiatement
setStudents(prev => prev.map(s => s.id === id ? {...s, isActive: !s.isActive} : s))
// 2. Écrire en base (onSnapshot confirmera)
await updateDoc(doc(db, 'students', id), { isActive: !current })
```

### Params en Next.js 16
```tsx
// params est une Promise dans Next.js 16
export default function Page({ params }: PageProps<'/path/[id]'>) {
  useEffect(() => {
    params.then(({ id }) => { /* ... */ })
  }, [])
}
```

---

## 8. Module Finance — Logique clé

### Génération mensuelle automatique (`monthly-generator.ts`)
- Au chargement de `/dashboard/finance`, `generateMissingMonths()` vérifie tous les mois passés de l'année scolaire active
- Pour chaque mois sans entrée pour un élève actif, crée un document `monthlyEntries` avec snapshot des frais à ce moment
- Idempotent : ne recrée pas ce qui existe déjà ; gère les nouveaux élèves ajoutés en cours d'année

### Allocation d'un versement (`finance-utils.ts`)
- `allocatePayment()` : solde du mois le plus ancien au plus récent, frais par frais, dans l'ordre des `selectedFeeIds`
- `allocateFamilyPayment()` : distribution à parts égales, redistribution itérative des excédents si un membre a une dette insuffisante
- `applyAllocationsToEntries()` : calcul optimiste des nouvelles valeurs `paid`/`balance` avant écriture Firestore

### Collections Firestore ajoutées
- `monthlyEntries` — une entrée par élève par mois, avec snapshot des frais, paid, balance
- `payments` — un document par versement avec toutes les allocations détaillées

## 9. Prochaines étapes (Module Pédagogie)
> À définir avec l'utilisateur.


---

## 9. Session de travail — 2026-06-10

### Problèmes résolus

#### Bug critique — Fermeture des modales et cards
**Symptôme** : Après avoir cliqué sur "Ajouter", "Enregistrer" ou "Valider", le bouton restait en état de chargement (affichant "Création…", "Enregistrement…" ou "…") et la fenêtre ne se fermait pas automatiquement. Il fallait cliquer manuellement sur "Annuler" pour fermer.

**Cause identifiée** : Firebase déclenche `onSnapshot` localement AVANT que la promesse `addDoc`/`updateDoc` soit résolue. Le re-render intermédiaire voyait `saving=true` et `showModal=true` en même temps, ce qui bloquait la fermeture.

**Solution appliquée** : Appeler la fermeture (`onClose()`, `onDone()`, `setEditing(false)`) AVANT le `await Firebase`, et mettre `setSaving(false)` dans le bloc `finally`.

**Fichiers corrigés** :
- `dashboard/_components/CreateSchoolYearModal.tsx`
- `dashboard/eleves/_components/AddStudentModal.tsx`
- `dashboard/eleves/_components/AddFamilyModal.tsx`
- `dashboard/frais/page.tsx` — FeeCard + AddFeeCard
- `dashboard/classes/page.tsx` — ClassCard + AddClassCard
- `dashboard/matieres/page.tsx` — SubjectCard + AddSubjectCard
- `dashboard/parametres/page.tsx` — handleSave (sans await) + handleSaveFee (fermeture immédiate)
- `dashboard/eleves/[id]/page.tsx` — toggleActive + assignFamily

#### Bug secondaire — Boutons "Enregistrer" lents dans Paramètres
**Symptôme** : Les boutons "Enregistrer" et "Valider" dans la page Paramètres prenaient plusieurs secondes avant de réagir car ils attendaient la confirmation du serveur Firebase.

**Solution appliquée** : 
- `handleSave` → `setDoc` appelé sans `await` (fire and forget)
- `handleSaveFee` → fermeture immédiate avant les appels Firebase

### Nouvelle fonctionnalité ajoutée

#### Édition complète des informations d'un élève
**Fichier** : `dashboard/eleves/[id]/page.tsx`

**Ce qui a été ajouté** :
- Bouton "Modifier" dans la carte Informations de la fiche élève
- Formulaire d'édition inline avec les champs : Prénom, Nom, Sexe, Classe, Date de naissance
- Validation : prénom et nom obligatoires, classe obligatoire
- Fermeture immédiate avant l'appel Firebase (pattern validé)
- Réouverture automatique du formulaire en cas d'erreur Firebase
- Chargement de toutes les classes de l'année scolaire pour le sélecteur

### Pattern validé et documenté
La règle de fermeture immédiate est maintenant appliquée uniformément dans tout le projet et documentée dans ce résumé sous la section "Règles métier clés" et "Patterns techniques importants".