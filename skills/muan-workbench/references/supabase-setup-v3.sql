-- ============================================================
-- 木案工作台 · 手机端 AI 代理（第三次执行，一次即可）
-- 前置：Database → Extensions → 搜索并启用 pg_net
-- 用法：把下方密钥换成你的 DeepSeek API Key 后，
--       Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 效果：手机端 AI 对话由数据库函数代调 DeepSeek，
--       密钥只存在数据库里，前端页面永不接触。
-- ============================================================

-- 1) 密钥表（只有数据库函数能读，普通账号/网页都读不到）
create table if not exists public.muan_ai_cfg (
  k text primary key,
  v text not null
);
alter table public.muan_ai_cfg enable row level security;
revoke all on public.muan_ai_cfg from anon, authenticated;

-- ↓↓↓↓↓ 在这里填入你的 DeepSeek API Key（sk-开头） ↓↓↓↓↓
insert into public.muan_ai_cfg(k,v) values ('apikey','在这里填sk-开头的DeepSeekKey')
  on conflict(k) do update set v=excluded.v;
insert into public.muan_ai_cfg(k,v) values ('base','https://api.deepseek.com')
  on conflict(k) do update set v=excluded.v;
insert into public.muan_ai_cfg(k,v) values ('model','deepseek-chat')
  on conflict(k) do update set v=excluded.v;

-- 2) 发起请求：返回一个 request id（pg_net 是异步的，稍后轮询）
create or replace function public.muan_ai_ask(payload text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  _key text; _base text; _model text; _req bigint;
  _body jsonb; _hd jsonb;
begin
  if auth.uid() is null then raise exception '需要登录'; end if;
  select v into _key from public.muan_ai_cfg where k='apikey';
  select v into _base from public.muan_ai_cfg where k='base';
  select v into _model from public.muan_ai_cfg where k='model';
  if _key is null or length(_key)<6 or _key like '%sk-开头%' then
    raise exception '尚未配置 DeepSeek API Key：请编辑 v3 脚本中的密钥行后重新执行';
  end if;
  if _base is null then _base := 'https://api.deepseek.com'; end if;
  if _model is null then _model := 'deepseek-chat'; end if;
  _body := (coalesce(payload,'{}')::jsonb - 'model') || jsonb_build_object('model',_model);
  _hd := jsonb_build_object('Authorization','Bearer '||_key,'Content-Type','application/json');
  select net.http_post(
    url    := _base || '/chat/completions',
    headers:= _hd,
    body   := _body
  ) into _req;
  return jsonb_build_object('id',_req::bigint);
end $$;

-- 3) 轮询结果
create or replace function public.muan_ai_poll(rid bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  _row record; _ct jsonb;
begin
  if auth.uid() is null then raise exception '需要登录'; end if;
  select status_code, (content)::jsonb into _row
  from net._http_response where id = rid;
  if _row is null then return jsonb_build_object('done',false); end if;
  if _row.status_code >= 300 then
    return jsonb_build_object('done',true,'ok',false,'error',('HTTP '||_row.status_code)::text);
  end if;
  _ct := _row.content;
  if (_ct->>'choices') is not null then
    return jsonb_build_object('done',true,'ok',true,'data',_ct);
  end if;
  return jsonb_build_object('done',true,'ok',false,'error',coalesce(_ct->>'message','模型返回异常'));
end $$;

-- 4) 放行：只有登录用户能调用（密钥表仍无人可读）
grant execute on function public.muan_ai_ask(text) to authenticated;
grant execute on function public.muan_ai_poll(bigint) to authenticated;
grant usage on schema net to authenticated;

-- 5) 自检：能列出 muan_ai_cfg 行说明脚本已生效（内容不会显示）
select k from public.muan_ai_cfg order by k;
