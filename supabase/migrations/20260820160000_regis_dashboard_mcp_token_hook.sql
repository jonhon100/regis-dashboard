-- Add MCP-specific claims only to OAuth access tokens. Existing browser sessions
-- and the tasks table/RLS policy are not changed.
create or replace function public.regis_dashboard_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
  oauth_client_id text := coalesce(event->>'client_id', claims->>'client_id');
begin
  if oauth_client_id is not null then
    claims := jsonb_set(
      claims,
      '{resource}',
      to_jsonb('https://wpxfslsluveavxmfoboa.supabase.co/functions/v1/regis-dashboard-mcp'::text)
    );
    claims := jsonb_set(
      claims,
      '{regis_dashboard_permissions}',
      '["tasks:read", "tasks:write", "tasks:delete"]'::jsonb
    );
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.regis_dashboard_mcp_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on function public.regis_dashboard_mcp_access_token_hook(jsonb) from authenticated, anon, public;

comment on function public.regis_dashboard_mcp_access_token_hook(jsonb) is
  'Adds resource and task permission claims to Supabase OAuth tokens used by the Regis Dashboard MCP server.';

