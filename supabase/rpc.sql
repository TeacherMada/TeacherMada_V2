-- -----------------------------------------------------------------------------
-- SECURITY MIGRATION: SECURE CREDIT MANAGEMENT
-- A exécuter dans l'éditeur SQL de Supabase pour la Phase 1
-- -----------------------------------------------------------------------------

-- 0. NETTOYAGE PRÉALABLE (CORRECTIF ERREUR 42P13)
-- On supprime explicitement les anciennes fonctions pour pouvoir redéfinir les noms des paramètres.
DROP FUNCTION IF EXISTS consume_credits(uuid, int);
DROP FUNCTION IF EXISTS add_credits(uuid, int);

-- 1. Fonction sécurisée pour CONSOMMER des crédits
-- Cette fonction empêche le "double spending" et les conditions de course.
-- Elle vérifie le solde et déduit le montant en une seule transaction atomique.
create or replace function consume_credits(p_user_id uuid, p_amount int)
returns boolean
language plpgsql
security definer -- S'exécute avec les droits de l'admin (nécessaire si l'utilisateur n'a pas droit d'écriture direct)
as $$
declare
  current_credits int;
begin
  -- Verrouille la ligne pour la mise à jour (évite les conflits simultanés)
  select credits into current_credits from profiles where id = p_user_id for update;

  -- Vérifie si l'utilisateur a assez de crédits
  if current_credits >= p_amount then
    update profiles set credits = credits - p_amount where id = p_user_id;
    return true; -- Succès
  else
    return false; -- Fonds insuffisants
  end if;
end;
$$;

-- 2. Fonction sécurisée pour AJOUTER des crédits
-- Permet d'ajouter des crédits sans écraser une transaction concurrente.
create or replace function add_credits(p_user_id uuid, p_amount int)
returns void
language plpgsql
security definer
as $$
begin
  update profiles 
  set credits = credits + p_amount 
  where id = p_user_id;
end;
$$;
