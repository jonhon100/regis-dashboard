import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { Hono } from 'npm:hono@4.9.7'
import { z } from 'npm:zod@4.1.13'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_PUBLIC_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const MCP_URL = `${SUPABASE_URL}/functions/v1/regis-dashboard-mcp`
const OAUTH_ISSUER = `${SUPABASE_URL}/auth/v1`
const RESOURCE_METADATA_URL = `${MCP_URL}/.well-known/oauth-protected-resource`
const OAUTH_SCOPES = ['openid', 'email']

const SECTIONS = ['important_today', 'today', 'general'] as const
const SECTION_RANK = Object.fromEntries(SECTIONS.map((section, index) => [section, index])) as Record<Section, number>
const REQUIRED_PERMISSIONS = ['tasks:read', 'tasks:write', 'tasks:delete'] as const
const oauthSecurity = [{ type: 'oauth2' as const, scopes: OAUTH_SCOPES }]

type Section = typeof SECTIONS[number]
type Permission = typeof REQUIRED_PERMISSIONS[number]
type Task = {
  id: number | string
  created_at: string
  title: string
  notes: string | null
  section: Section
  completed: boolean
  sort_order: number
}

type JwtClaims = {
  iss?: string
  sub?: string
  exp?: number
  client_id?: string
  resource?: string | string[]
  regis_dashboard_permissions?: string[]
}

function jsonText(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString()
    return item
  }, 2)
}

function decodeJwtPayload(token: string): JwtClaims {
  const encoded = token.split('.')[1]
  if (!encoded) throw new Error('Malformed access token')

  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))))
}

function bearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function authChallenge(description: string) {
  return {
    content: [{ type: 'text' as const, text: description }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="${OAUTH_SCOPES.join(' ')}", error="invalid_token", error_description="${description.replaceAll('"', "'")}"`,
      ],
    },
  }
}

function toolError(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  }
}

async function authorize(
  authorizationHeader: string | undefined,
  permission: Permission,
): Promise<{ db: SupabaseClient; userId: string } | { error: ReturnType<typeof authChallenge> }> {
  const token = bearerToken(authorizationHeader)
  if (!token) return { error: authChallenge('Sign in to Regis Dashboard to use this tool.') }

  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    return { error: authChallenge('The Regis Dashboard server is not configured correctly.') }
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) return { error: authChallenge('Your Regis Dashboard authorization is invalid or expired.') }

  let claims: JwtClaims
  try {
    claims = decodeJwtPayload(token)
  } catch {
    return { error: authChallenge('The Regis Dashboard access token could not be read.') }
  }

  const resources = Array.isArray(claims.resource) ? claims.resource : [claims.resource]
  const permissions = claims.regis_dashboard_permissions ?? []
  const now = Math.floor(Date.now() / 1000)

  if (
    claims.iss !== OAUTH_ISSUER ||
    claims.sub !== user.id ||
    !claims.client_id ||
    !claims.exp ||
    claims.exp <= now ||
    !resources.includes(MCP_URL) ||
    !permissions.includes(permission)
  ) {
    return { error: authChallenge('This token was not issued for the Regis Dashboard MCP app or lacks permission.') }
  }

  const db = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { db, userId: user.id }
}

async function nextSortOrder(db: SupabaseClient, section: Section) {
  const { data, error } = await db
    .from('tasks')
    .select('sort_order')
    .eq('section', section)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Number(data?.sort_order ?? -1) + 1
}

function makeServer(authorizationHeader: string | undefined) {
  const server = new McpServer({ name: 'Regis Dashboard', version: '1.0.0' })

  server.registerTool(
    'list_tasks',
    {
      title: 'List Regis Dashboard tasks',
      description: 'List tasks in their saved order. By default returns active tasks; optionally filter by section or include completed tasks.',
      inputSchema: {
        section: z.enum(SECTIONS).optional().describe('Optional task section'),
        include_completed: z.boolean().default(false).describe('Whether completed tasks should be included'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      securitySchemes: oauthSecurity,
      _meta: { securitySchemes: oauthSecurity },
    },
    async ({ section, include_completed }) => {
      const auth = await authorize(authorizationHeader, 'tasks:read')
      if ('error' in auth) return auth.error

      let query = auth.db
        .from('tasks')
        .select('id,created_at,title,notes,section,completed,sort_order')
        .order('section')
        .order('sort_order')
        .order('created_at')

      if (section) query = query.eq('section', section)
      if (!include_completed) query = query.eq('completed', false)

      const { data, error } = await query
      if (error) return toolError(`Could not list tasks: ${error.message}`)

      const tasks = (data ?? []).toSorted((left, right) =>
        (SECTION_RANK[left.section as Section] ?? SECTIONS.length) -
          (SECTION_RANK[right.section as Section] ?? SECTIONS.length) ||
        Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) ||
        String(left.created_at).localeCompare(String(right.created_at))
      )

      return {
        content: [{ type: 'text', text: jsonText({ tasks }) }],
        structuredContent: { tasks },
      }
    },
  )

  server.registerTool(
    'get_task',
    {
      title: 'Read a Regis Dashboard task',
      description: 'Read one task, including its notes, by its exact task ID.',
      inputSchema: { task_id: z.string().regex(/^\d+$/).describe('Exact task ID returned by list_tasks') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      securitySchemes: oauthSecurity,
      _meta: { securitySchemes: oauthSecurity },
    },
    async ({ task_id }) => {
      const auth = await authorize(authorizationHeader, 'tasks:read')
      if ('error' in auth) return auth.error

      const { data, error } = await auth.db
        .from('tasks')
        .select('id,created_at,title,notes,section,completed,sort_order')
        .eq('id', task_id)
        .maybeSingle<Task>()

      if (error) return toolError(`Could not read task: ${error.message}`)
      if (!data) return toolError(`No accessible task exists with ID ${task_id}.`)

      return {
        content: [{ type: 'text', text: jsonText({ task: data }) }],
        structuredContent: { task: data },
      }
    },
  )

  server.registerTool(
    'create_task',
    {
      title: 'Create a Regis Dashboard task',
      description: 'Create a task at the end of a section. Natural-language interpretation belongs in ChatGPT; pass a clean title, optional notes, and exact section.',
      inputSchema: {
        title: z.string().trim().min(1).max(500),
        notes: z.string().max(10000).optional(),
        section: z.enum(SECTIONS),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      securitySchemes: oauthSecurity,
      _meta: { securitySchemes: oauthSecurity },
    },
    async ({ title, notes, section }) => {
      const auth = await authorize(authorizationHeader, 'tasks:write')
      if ('error' in auth) return auth.error

      try {
        const sortOrder = await nextSortOrder(auth.db, section)
        const { data, error } = await auth.db
          .from('tasks')
          .insert({ title, notes: notes ?? null, section, completed: false, sort_order: sortOrder })
          .select('id,created_at,title,notes,section,completed,sort_order')
          .single<Task>()

        if (error) return toolError(`Could not create task: ${error.message}`)
        return {
          content: [{ type: 'text', text: `Created task “${data.title}” in ${data.section}.\n${jsonText({ task: data })}` }],
          structuredContent: { task: data },
        }
      } catch (error) {
        return toolError(`Could not determine task order: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  )

  server.registerTool(
    'update_task',
    {
      title: 'Update a Regis Dashboard task',
      description: 'Change a task title, notes, section, sort order, or completion state. Resolve the task with list_tasks first; do not guess an ID.',
      inputSchema: {
        task_id: z.string().regex(/^\d+$/).describe('Exact task ID returned by list_tasks'),
        title: z.string().trim().min(1).max(500).optional(),
        notes: z.string().max(10000).nullable().optional().describe('Use null to clear notes'),
        section: z.enum(SECTIONS).optional(),
        sort_order: z.number().int().nonnegative().optional(),
        completed: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      securitySchemes: oauthSecurity,
      _meta: { securitySchemes: oauthSecurity },
    },
    async ({ task_id, title, notes, section, sort_order, completed }) => {
      const auth = await authorize(authorizationHeader, 'tasks:write')
      if ('error' in auth) return auth.error

      const { data: current, error: readError } = await auth.db
        .from('tasks')
        .select('id,created_at,title,notes,section,completed,sort_order')
        .eq('id', task_id)
        .maybeSingle<Task>()

      if (readError) return toolError(`Could not read task before update: ${readError.message}`)
      if (!current) return toolError(`No accessible task exists with ID ${task_id}.`)

      const changes: Record<string, unknown> = {}
      if (title !== undefined) changes.title = title
      if (notes !== undefined) changes.notes = notes
      if (section !== undefined) changes.section = section
      if (sort_order !== undefined) changes.sort_order = sort_order
      if (completed !== undefined) changes.completed = completed

      if (Object.keys(changes).length === 0) return toolError('No task changes were supplied.')

      if (section && section !== current.section && sort_order === undefined) {
        try {
          changes.sort_order = await nextSortOrder(auth.db, section)
        } catch (error) {
          return toolError(`Could not determine task order: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const { data, error } = await auth.db
        .from('tasks')
        .update(changes)
        .eq('id', task_id)
        .select('id,created_at,title,notes,section,completed,sort_order')
        .single<Task>()

      if (error) return toolError(`Could not update task: ${error.message}`)
      return {
        content: [{ type: 'text', text: `Updated task “${data.title}”.\n${jsonText({ task: data })}` }],
        structuredContent: { task: data },
      }
    },
  )

  server.registerTool(
    'delete_task',
    {
      title: 'Delete a Regis Dashboard task',
      description: 'Permanently delete one task. Resolve it with list_tasks first and pass its exact current title as confirmation. Ask the user for confirmation immediately before calling.',
      inputSchema: {
        task_id: z.string().regex(/^\d+$/).describe('Exact task ID returned by list_tasks'),
        confirm_title: z.string().describe('Exact current task title, copied from list_tasks'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      securitySchemes: oauthSecurity,
      _meta: { securitySchemes: oauthSecurity },
    },
    async ({ task_id, confirm_title }) => {
      const auth = await authorize(authorizationHeader, 'tasks:delete')
      if ('error' in auth) return auth.error

      const { data: current, error: readError } = await auth.db
        .from('tasks')
        .select('id,title')
        .eq('id', task_id)
        .maybeSingle<{ id: number | string; title: string }>()

      if (readError) return toolError(`Could not read task before deletion: ${readError.message}`)
      if (!current) return toolError(`No accessible task exists with ID ${task_id}.`)
      if (confirm_title !== current.title) return toolError('Deletion refused: confirm_title does not exactly match the current task title.')

      const { error } = await auth.db.from('tasks').delete().eq('id', task_id)
      if (error) return toolError(`Could not delete task: ${error.message}`)

      return {
        content: [{ type: 'text', text: `Deleted task “${current.title}” (ID ${String(current.id)}).` }],
        structuredContent: { deleted: true, task_id: String(current.id), title: current.title },
      }
    },
  )

  return server
}

const app = new Hono().basePath('/regis-dashboard-mcp')

app.get('/health', (context) => context.json({ ok: true, service: 'regis-dashboard-mcp' }))

app.get('/.well-known/oauth-protected-resource', (context) => context.json({
  resource: MCP_URL,
  authorization_servers: [OAUTH_ISSUER],
  scopes_supported: OAUTH_SCOPES,
  bearer_methods_supported: ['header'],
}, 200, { 'Cache-Control': 'public, max-age=300' }))

app.all('/', async (context) => {
  const authorizationHeader = context.req.header('Authorization')

  // Supabase cannot route the RFC 9728 origin-level well-known path to an
  // individual Edge Function. Advertise the function-scoped metadata URL in
  // the standard HTTP challenge so MCP clients can discover it reliably.
  if (!bearerToken(authorizationHeader)) {
    return context.json(
      { error: 'unauthorized', error_description: 'OAuth authorization is required.' },
      401,
      {
        'Cache-Control': 'no-store',
        'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="${OAUTH_SCOPES.join(' ')}"`,
        'Access-Control-Expose-Headers': 'WWW-Authenticate',
      },
    )
  }

  const server = makeServer(authorizationHeader)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(context.req.raw)
})

Deno.serve(app.fetch)
