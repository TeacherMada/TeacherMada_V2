# 🎓 TeacherMada - Votre Professeur de Langue Personnel

TeacherMada est une application web progressive (PWA) conçue pour démocratiser l'apprentissage des langues. Elle combine l'intelligence artificielle générative (Google Gemini) avec une pédagogie structurée pour offrir une expérience d'apprentissage fluide, personnalisée et accessible.

## 🏗️ Architecture de l'Application

Le projet suit une architecture **Serverless / Hybride** moderne, optimisée pour la performance et la facilité de déploiement.

### 1. Frontend (Le Cœur)
*   **Framework**: React 19 (Hooks, Context, Streaming SSR support).
*   **Build Tool**: Vite (Rapide, HMR optimisé).
*   **Langage**: TypeScript (Typage strict pour la robustesse).
*   **Styling**: Tailwind CSS (Design responsive, Dark mode natif).
*   **Icons**: Lucide React.

### 2. Services & Logique Métier (`src/services/`)
L'application ne dépend pas d'un backend Node.js complexe. La logique est déportée dans des services côté client qui communiquent avec des APIs :
*   **`geminiService.ts`** :
    *   Interface directe avec l'API Google Gemini (`@google/genai`).
    *   Modèle utilisé : `gemini-3-flash-preview` (Optimisé pour latence et coût).
    *   Fonctionnalités : Streaming, Extraction JSON (Vocabulaire, Exercices), Roleplay.
*   **`storageService.ts`** :
    *   Agit comme une couche d'abstraction (Pattern Facade).
    *   Gère la synchronisation **Supabase** (Base de données PostgreSQL) pour les utilisateurs connectés.
    *   Gère le repli sur **LocalStorage** pour le mode hors-ligne ou sans compte.
    *   Centralise la logique des Crédits, de l'Authentification et des Paramètres Système.

### 3. Base de Données (Supabase)
TeacherMada utilise Supabase comme Backend-as-a-Service (BaaS) :
*   **Authentification** : Gestion des utilisateurs (email/password custom).
*   **Tables** : `profiles` (stats, crédits, vocabulaire), `admin_requests` (paiements mobile money).
*   **Sécurité** : Row Level Security (RLS) configuré pour protéger les données.

### 4. Composants Clés (`src/components/`)
*   **`ChatInterface`** : Le moteur de conversation. Gère l'historique, le Markdown, et le feedback visuel du streaming.
*   **`SmartDashboard`** : Le panneau de contrôle de l'élève. Affiche les statistiques, le vocabulaire extrait par IA, et les réglages.
*   **`DialogueSession`** : Module de mise en situation (Roleplay) avec objectifs et correction automatique.
*   **`PaymentModal`** : Interface de rechargement de crédits via Mobile Money (MVola, Orange, Airtel).
*   **`Toaster`** : Système de notifications global.

## 📘 Spécifications Techniques & Design System

### A. Stack Technologique
| Composant | Technologie |
| :--- | :--- |
| **Runtime** | React 19 + TypeScript |
| **Styling** | Tailwind CSS v3.4 |
| **AI SDK** | @google/genai v0.2.0 |
| **Icons** | Lucide React |
| **Markdown** | React-Markdown + Remark-GFM |
| **Date** | ISO 8601 Timestamp (number) |

### B. Structure des Dossiers
```
src/
├── components/       # Composants UI (Chat, Modal, Dashboard...)
├── services/         # Logique métier (API Calls, Storage)
├── types.ts          # Définitions TypeScript (Interfaces, Enums)
├── constants.ts      # Prompts système, Configs statiques
├── App.tsx           # Routeur logique et State Manager global
└── main.tsx          # Point d'entrée
```

### C. Design System (Tailwind)
*   **Couleurs Primaires** : `Indigo-600` (Action), `Slate-900` (Fond Dark), `Slate-50` (Fond Light).
*   **Feedback** : `Emerald-500` (Succès), `Red-500` (Erreur), `Amber-500` (Info/XP).
*   **Typography** : `Plus Jakarta Sans` (Sans-serif moderne).
*   **Animations** : `fade-in`, `slide-up`, `bounce-slight` (CSS custom dans `index.html`).

## 🚀 Fonctionnalités Principales

1.  **Professeur IA (Gemini 2.0)** :
    *   Correction instantanée des erreurs.
    *   Adaptation au niveau (A1 à C2).
    *   Explications en Français ou Malagasy.

2.  **Smart Vocabulary** :
    *   Extraction automatique des mots difficiles d'une conversation.
    *   Génération de définitions et exemples contextuels.
    *   Synthèse vocale (Text-to-Speech) pour la prononciation.

3.  **Mode Roleplay** :
    *   Scénarios pré-définis (Marché, Médecin, Entretien...).
    *   Chronomètre (1 min = 1 crédit).
    *   Score et feedback final.

4.  **Admin Dashboard** :
    *   Gestion des utilisateurs et des crédits.
    *   Validation des paiements Mobile Money.
    *   Ajout dynamique de nouvelles langues.

## 📦 Installation & Développement

1.  Cloner le repo.
2.  `npm install`
3.  Créer un fichier `.env` avec :
    *   `API_KEY` (Clé Gemini - Google AI Studio)
    *   `VITE_SUPABASE_URL`
    *   `VITE_SUPABASE_ANON_KEY`
4.  `npm run dev` pour lancer le serveur local.

---
© TeacherMada Team - Education for All.