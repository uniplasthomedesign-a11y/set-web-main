-- Optional Supabase hosting. The Netlify store deletes orders in server/local-store.cjs.
create or replace function public.delete_order(p_order_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype;v_line record;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select * into strict v_order from public.orders where id=p_order_id for update;
  if v_order.status<>'cancelled' then
    for v_line in select product_id,cartons from public.order_items where order_id=p_order_id and stock_reserved loop
      update public.products set stock_cartons=stock_cartons+v_line.cartons where id=v_line.product_id and stock_cartons is not null;
    end loop;
  end if;
  delete from public.orders where id=p_order_id;
  insert into public.audit_log(actor,action,entity_id,details) values(auth.uid(),'order_delete',p_order_id,jsonb_build_object('reference',v_order.reference));
end;$$;
revoke all on function public.delete_order(uuid) from public;
grant execute on function public.delete_order(uuid) to authenticated;
