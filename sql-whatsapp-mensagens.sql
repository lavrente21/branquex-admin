-- BRANQUEX · Mensagens de WhatsApp personalizáveis
-- Execute UMA vez no Supabase: SQL Editor > New query > colar > Run.
-- Não apaga nem altera dados existentes: só acrescenta uma coluna às configurações da loja.

alter table public.store_settings
  add column if not exists whatsapp_templates jsonb not null default '{}'::jsonb;
