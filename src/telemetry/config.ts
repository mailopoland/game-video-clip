/**
 * Konfiguracja telemetrii (ADR-0026).
 *
 * Klucz jest tu JAWNIE i tak ma byc: to `publishable` (dawne `anon`) key,
 * publiczny z definicji — dokladnie ten sam string leci w kazdym zadaniu
 * z przegladarki i i tak siedzi w bundlu produkcyjnym. Przeniesienie go do
 * `.env` niczego by nie ukrylo, a dolozyloby konfiguracje do CI.
 *
 * Uprawnienia tego klucza to WYLACZNIE INSERT do `public.events` — bez SELECT,
 * UPDATE i DELETE (polityki RLS w `docs/SUPABASE.md`). Klucz `service_role`
 * nie jest do niczego potrzebny i nie moze trafic ani tutaj, ani do repo.
 */

export const SUPABASE_URL = 'https://dtbtvmsxhhsjieodqjos.supabase.co';

export const SUPABASE_KEY = 'sb_publishable_IU4Jd6eKYKZGYGHw5Xb3MA_5fG-8rWI';

export const EVENTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/events`;
