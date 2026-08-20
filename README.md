# Regis Dashboard

Regis Dashboard is a deliberately simple three-section task list backed by Supabase.

Live dashboard: <https://jonhon100.github.io/regis-dashboard/>

## Current dashboard

The browser application in `index.html` supports:

- Supabase email/password authentication
- Important Today, Today, and General task sections
- creating, editing, completing, and deleting tasks
- desktop and touch drag-and-drop
- persistent task sections and ordering

The existing browser publishable key is intentionally public. Supabase Row Level Security remains the boundary between signed-in users and task data.

## ChatGPT integration

This repository includes a small remote MCP server for ChatGPT in `supabase/functions/regis-dashboard-mcp`. It exposes structured tools for:

- listing and reading tasks
- creating tasks
- updating title, notes, section, order, and completion state
- deleting a task after an exact-title confirmation

ChatGPT interprets natural language and calls these tools. The MCP server does not contain an AI model.

### Security model

- Supabase Auth is the OAuth 2.1 authorization server.
- The OAuth consent page is `oauth/consent/index.html` on GitHub Pages.
- ChatGPT receives a user-delegated OAuth token, never a password or service-role key.
- The Edge Function validates each bearer token and its MCP-specific claims.
- Database requests forward that same user token, so the existing task RLS policy continues to apply.
- There is no privileged database client in the function.
- Tool calls are rejected unless the token contains the exact MCP resource and required task permissions.

The Edge Function is deployed with gateway JWT verification disabled only because MCP discovery and OAuth challenges must be reachable before authentication. Every task tool performs its own Supabase Auth validation before touching the database.

## Supabase setup

These steps are required once after this branch is reviewed and merged.

1. Apply `supabase/migrations/20260820160000_regis_dashboard_mcp_token_hook.sql` to the Regis Dashboard project.
2. In **Authentication → Hooks**, enable the Custom Access Token hook and select `public.regis_dashboard_mcp_access_token_hook`.
3. In **Authentication → URL Configuration**, confirm the Site URL is `https://jonhon100.github.io/regis-dashboard`.
4. In **Authentication → OAuth Server**, enable OAuth 2.1 and configure:
   - Authorization path: `/oauth/consent/`
   - Dynamic client registration: enabled
   - User approval: required
5. Deploy the function:

   ```sh
   supabase functions deploy regis-dashboard-mcp --no-verify-jwt
   ```

6. Confirm both endpoints respond:
   - `https://wpxfslsluveavxmfoboa.supabase.co/functions/v1/regis-dashboard-mcp/health`
   - `https://wpxfslsluveavxmfoboa.supabase.co/functions/v1/regis-dashboard-mcp/.well-known/oauth-protected-resource`

No changes to the `tasks` table or its data are required.

## Connect in ChatGPT

This uses ChatGPT Developer Mode and a custom MCP app on ChatGPT web.

1. Open **Settings → Security and login → Developer mode** and enable it.
2. Open **ChatGPT Plugins**, choose **+**, and create a developer app.
3. Use this MCP URL:

   ```text
   https://wpxfslsluveavxmfoboa.supabase.co/functions/v1/regis-dashboard-mcp
   ```

4. Complete the Regis Dashboard sign-in and consent flow.
5. Select the Regis Dashboard app for the conversation, then test:

   > Add Test AI Task to Important Today.

The app can be selected in an ordinary ChatGPT conversation. A ChatGPT Project may hold related instructions, but a Project does not automatically connect or activate the MCP app.

