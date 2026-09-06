-- ============================================================
-- 木案工作台 · 云同步建表脚本（只需执行一次）
-- 用法：打开 Supabase 控制台 → 左侧「SQL Editor」→ New query
--       → 粘贴本文件全部内容 → 点「Run」→ 提示 Success 即完成
-- 作用：建一张 muan_state 表，每个登录用户只能读写自己的那一行
-- ============================================================

-- 1) 建表：整个工作台状态存成一个 JSON，用 rev 做版本号防互相覆盖
create table if not exists public.muan_state (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  rev        bigint not null default 1,
  device     text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) 开启行级安全（RLS）：这是"别人拿到网址也进不来"的根本保障
alter table public.muan_state enable row level security;

-- 3) 四条策略：每人只能增删改查自己（auth.uid()）那一行
drop policy if exists "muan_select_own" on public.muan_state;
drop policy if exists "muan_insert_own" on public.muan_state;
drop policy if exists "muan_update_own" on public.muan_state;
drop policy if exists "muan_delete_own" on public.muan_state;

create policy "muan_select_own" on public.muan_state
  for select using (auth.uid() = user_id);
create policy "muan_insert_own" on public.muan_state
  for insert with check (auth.uid() = user_id);
create policy "muan_update_own" on public.muan_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "muan_delete_own" on public.muan_state
  for delete using (auth.uid() = user_id);

-- 4) 每次更新时自动刷新 updated_at（云端时间，用来判断谁更新）
create or replace function public.muan_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_muan_touch on public.muan_state;
create trigger trg_muan_touch
  before update on public.muan_state
  for each row execute function public.muan_touch_updated_at();

-- 5) 自检：执行后应能看到一行结果（列名含 muan_state 即成功）
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'muan_state';
