-- Applied as migration "v2_harden_function_grants".
-- Helper fns: callable only by signed-in users (RLS policies run as the caller's role).
revoke execute on function public.is_regional(), public.my_market(), public.has_profile() from public, anon;
grant execute on function public.is_regional(), public.my_market(), public.has_profile() to authenticated;

-- Trigger functions never need direct RPC access (triggers fire as table owner).
alter function public.touch_updated_at() security invoker;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_auto_confirm() from public, anon, authenticated;
