
# 🚀 TeacherMada - Mise à jour v2.2 "Optimisation & Fixes"

## 📋 Nouveautés & Correctifs

1.  **Barre de Progression (UX/UI)** :
    *   **Format Mobile First** : Nouveau design responsive `Niveau Actuel (Gauche) -- % -- Niveau Suivant (Droite)` (ex: `A1 -- 42% --> A2`).
    *   **Synchronisation** : Mise à jour visible dans le pied de page du Chat et dans la Sidebar du Profil (SmartDashboard).

2.  **Appel Vocal (Live API)** :
    *   **Teacher Speaks First** : Correction de la logique pour forcer l'IA à prendre la parole immédiatement au début de l'appel (Présentation, guide).
    *   **Stabilité Audio** : Amélioration de l'initialisation du contexte audio pour contourner les politiques d'autoplay des navigateurs.

3.  **Dashboard Admin (Supabase)** :
    *   **Affichage des Requêtes** : Correction du mapping des données pour afficher correctement la liste complète des demandes de crédits (`admin_requests`) depuis Supabase.
    *   **Auto-Cleanup** : Fonction automatique qui supprime les requêtes vieilles de plus de 7 jours lors du chargement du dashboard pour économiser le stockage.

## 🛠️ Modifications Techniques

*   **`ChatInterface.tsx`** : Refonte du footer pour la progression et mise à jour de la logique `startLiveSession` avec un trigger textuel caché ("Hello teacher...").
*   **`storageService.ts`** : 
    *   Mise à jour de `getAdminRequests` pour mapper correctement le snake_case (DB) vers camelCase (App).
    *   Ajout de la fonction `cleanupOldRequests`.
*   **`SmartDashboard.tsx`** : Harmonisation visuelle de la barre de progression latérale.

## ⚠️ Action Requise (Base de Données)

Pour que le Dashboard Admin fonctionne correctement avec les nouvelles fonctionnalités, exécutez ce script SQL dans votre éditeur Supabase :

```sql
create table if not exists admin_requests (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  username text not null,
  type text not null,
  amount numeric,
  message text,
  status text default 'pending',
  created_at timestamptz default now()
);

-- Sécurité (RLS)
alter table admin_requests enable row level security;
create policy "Enable insert for everyone" on admin_requests for insert with check (true);
create policy "Enable read for everyone" on admin_requests for select using (true);
create policy "Enable update for everyone" on admin_requests for update using (true);
```
