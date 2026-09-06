-- ============================================================
-- 木案工作台 · 云端版本留档（第二次执行，一次即可）
-- 作用：muan_state 每次被覆盖前，自动把"上一版"存进历史表（每人最多留 50 份）。
--       之后在 App 设置 → 数据与同步 → 🕘云端备份 里可以按版本取回。
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================

-- 1) 历史表
create table if not exists public.muan_state_hist (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  rev     bigint not null,
  data    jsonb not null,
  device  text,
  ts      timestamptz not null default now()
);
create index if not exists idx_muan_hist_user on public.muan_state_hist(user_id, id desc);

-- 2) 行级安全：只能读自己的历史
alter table public.muan_state_hist enable row level security;
drop policy if exists "muan_hist_select_own" on public.muan_state_hist;
create policy "muan_hist_select_own" on public.muan_state_hist
  for select using (auth.uid() = user_id);

-- 3) 覆盖前自动留档（security definer：由表属主执行，普通用户无需写权限）
create or replace function public.muan_archive_old()
returns trigger language plpgsql security definer as $$
begin
  if old.data is not null then
    insert into public.muan_state_hist (user_id, rev, data, device)
    values (old.user_id, old.rev, old.data, old.device);
    -- 每人只留最近 50 份
    delete from public.muan_state_hist h
    where h.user_id = old.user_id
      and h.id not in (
        select h2.id from public.muan_state_hist h2
        where h2.user_id = old.user_id order by h2.id desc limit 50
      );
  end if;
  return new;
end $$;

drop trigger if exists trg_muan_archive on public.muan_state;
create trigger trg_muan_archive
  after insert or update on public.muan_state
  for each row execute function public.muan_archive_old();

-- 4) 自检：能看到 muan_state_hist 即成功
select tablename, rowsecurity
from pg_tables
where schemaname='public' and tablename='muan_state_hist';
