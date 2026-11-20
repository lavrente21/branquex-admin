-- BRANQUEX · Transferir encomenda para outra zona (município)
-- Execute UMA vez no Supabase: SQL Editor > New query > colar > Run.
-- Muda o município, passa a taxa de entrega para a do novo município e acerta o total.
-- Não mexe no stock nem nos pagamentos. Só funciona com sessão iniciada (admin), não com visitantes da loja.
-- Nota: assume que os ids são uuid e que existem orders.municipality_id, orders.delivery_fee, orders.total e municipalities.fee.

create or replace function public.transfer_order_zone(p_order_id uuid, p_municipality_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee numeric;
  v_old numeric;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Sem permissão.' using errcode = 'P0001';
  end if;

  select fee into v_fee from public.municipalities where id = p_municipality_id;
  if not found then
    raise exception 'Município inválido.' using errcode = 'P0001';
  end if;

  select coalesce(delivery_fee, 0), status into v_old, v_status
  from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Encomenda não encontrada.' using errcode = 'P0001';
  end if;
  if v_status in ('Cancelada', 'Entregue', 'Levantada') then
    raise exception 'Esta encomenda já não pode mudar de zona.' using errcode = 'P0001';
  end if;

  update public.orders
     set municipality_id = p_municipality_id,
         delivery_fee    = coalesce(v_fee, 0),
         total           = total - v_old + coalesce(v_fee, 0)
   where id = p_order_id;
end;
$$;

revoke all on function public.transfer_order_zone(uuid, uuid) from public, anon;
grant execute on function public.transfer_order_zone(uuid, uuid) to authenticated;
