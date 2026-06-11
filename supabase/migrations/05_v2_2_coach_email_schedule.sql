-- Applied as migrations "v2_2_coach_email_schedule" + "v2_2_vault_secret_accessor".
-- Sunday-evening Coach's Card email: cron trigger + secrets plumbing.
-- NOTE: secret values are REDACTED here (public repo); real values live in
-- Supabase Vault on the project.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Shared secret so only our cron job can trigger a real (all-recipients) send.
select vault.create_secret('<REDACTED>', 'coach_email_cron_secret', 'Header secret for weekly-coach-email cron trigger');

-- Vault isn't exposed over PostgREST; the edge function reads secrets through
-- this service-role-only accessor.
create or replace function public.get_vault_secret(p_name text)
returns text language sql stable security definer
set search_path = vault, public as
$$ select decrypted_secret from vault.decrypted_secrets where name = p_name $$;
revoke execute on function public.get_vault_secret(text) from public, anon, authenticated;
grant execute on function public.get_vault_secret(text) to service_role;

-- 00:00 UTC Monday = 7pm Sunday Central (CDT; 6pm CST in winter — accepted).
select cron.schedule(
  'weekly-coach-email',
  '0 0 * * 1',
  $$
  select net.http_post(
    url := 'https://payymfcvjrhxlgzyplvx.supabase.co/functions/v1/weekly-coach-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <anon key>',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'coach_email_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Runtime secrets expected in Vault (added separately, never committed):
--   resend_api_key          Resend API key for sending
--   coach_email_from        optional From address, e.g. 'Performance Tracker <tracker@jakesregion.net>'
--   coach_email_cron_secret trigger secret above