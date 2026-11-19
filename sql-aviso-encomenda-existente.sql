-- BRANQUEX · Aviso na loja quando o cliente já tem uma encomenda hoje
-- Execute UMA vez no Supabase: SQL Editor > New query > colar > Run.
-- Não altera nem apaga dados: só cria uma função que devolve true/false (não expõe dados do cliente).
-- Nota: assume orders.customer_id -> customers.id (como no resto do painel). Se der erro de coluna, diga-me.

create or replace function public.phone_has_active_order(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9)
        = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9)
      and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 9
      and o.status <> 'Cancelada'
      and (o.created_at at time zone 'Africa/Luanda')::date = (now() at time zone 'Africa/Luanda')::date
  );
$$;

revoke all on function public.phone_has_active_order(text) from public;
grant execute on function public.phone_has_active_order(text) to anon, authenticated;
