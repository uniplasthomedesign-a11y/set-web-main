-- Optional Supabase hosting. The Netlify store keeps these fields in its JSON documents.
alter table public.products add column if not exists pallet_enabled boolean;
alter table public.products add column if not exists pallet_cartons integer
  check (pallet_cartons is null or (pallet_cartons between 1 and 10000));
