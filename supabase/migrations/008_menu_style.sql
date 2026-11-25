alter table public.store_settings
  add column if not exists menu_style text not null default 'floating'
  check (menu_style in ('floating', 'classic', 'sheet'));
