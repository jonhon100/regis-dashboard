import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_PUBLIC_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const OPENAI_MODEL = 'gpt-5.6-luna'

const SECTIONS = ['important_today', 'today', 'general'] as const
const SECTION_RANK = Object.fromEntries(SECTIONS.map((section, index) => [section, index])) as Record<Section, number>
const MAX_TOOL_ROUNDS = 4

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Section = typeof SECTIONS[number]
type Task = {
  id: number | string
  created_at: string
  title: string
  notes: string | null
  section: Section
  completed: boolean
  sort_order: number
}

type ResponseItem = {
  type?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string }>
  [key: string]: unknown
}

type OpenAIResponse = {
  output?: ResponseItem[]
}

const tools = [
  {
    type: 'function',
    name: 'list_tasks',
    description: 'List the signed-in user\'s Regis Dashboard tasks in dashboard section and saved order.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: ['string', 'null'],
          enum: [...SECTIONS, null],
          description: 'A section to filter by, or null for all sections.',
        },
        include_completed: {
          type: 'boolean',
          description: 'Whether to include completed tasks.',
        },
      },
      required: ['section', 'include_completed'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'create_task',
    description: 'Create a new task at the end of one Regis Dashboard section.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A concise task title.' },
        notes: { type: ['string', 'null'], description: 'Optional task notes, or null.' },
        section: { type: 'string', enum: SECTIONS, description: 'The exact dashboard section.' },
      },
      required: ['title', 'notes', 'section'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'update_task',
    description: 'Update one task returned by list_tasks. Supports title/notes edits, completion changes, and moves to another section. A moved task is placed at the end automatically.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          pattern: '^\\d+$',
          description: 'The exact task ID returned by list_tasks.',
        },
        current_title: {
          type: 'string',
          description: 'The exact current title copied from list_tasks.',
        },
        title: {
          type: ['string', 'null'],
          description: 'A replacement title, or null to leave the title unchanged.',
        },
        notes_mode: {
          type: 'string',
          enum: ['unchanged', 'replace', 'clear'],
          description: 'Whether to leave, replace, or clear the task notes.',
        },
        notes: {
          type: ['string', 'null'],
          description: 'Replacement notes when notes_mode is replace; otherwise null.',
        },
        section: {
          type: ['string', 'null'],
          enum: [...SECTIONS, null],
          description: 'A destination section, or null to leave the section unchanged.',
        },
        completed: {
          type: ['boolean', 'null'],
          description: 'True to complete, false to mark incomplete, or null to leave unchanged.',
        },
      },
      required: ['task_id', 'current_title', 'title', 'notes_mode', 'notes', 'section', 'completed'],
      additionalProperties: false,
    },
    strict: true,
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function bearerToken(header: string | null) {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1]
}

function isSection(value: unknown): value is Section {
  return typeof value === 'string' && SECTIONS.includes(value as Section)
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
  return Number(data?.sort_order ?? 0) + 1
}

async function listTasks(db: SupabaseClient, args: Record<string, unknown>) {
  const section = args.section
  const includeCompleted = args.include_completed === true

  if (section !== null && !isSection(section)) throw new Error('Invalid task section.')

  let query = db
    .from('tasks')
    .select('id,created_at,title,notes,section,completed,sort_order')
    .order('sort_order')
    .order('created_at')

  if (section) query = query.eq('section', section)
  if (!includeCompleted) query = query.eq('completed', false)

  const { data, error } = await query
  if (error) throw error

  const tasks = (data ?? []).toSorted((left, right) =>
    (SECTION_RANK[left.section as Section] ?? SECTIONS.length) -
      (SECTION_RANK[right.section as Section] ?? SECTIONS.length) ||
    Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) ||
    String(left.created_at).localeCompare(String(right.created_at))
  )

  return { tasks }
}

async function createTask(db: SupabaseClient, args: Record<string, unknown>) {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  const notes = typeof args.notes === 'string' ? args.notes.trim() : null
  const section = args.section

  if (!title || title.length > 500) throw new Error('Task title must be between 1 and 500 characters.')
  if (typeof notes === 'string' && notes.length > 10000) throw new Error('Task notes are too long.')
  if (!isSection(section)) throw new Error('Invalid task section.')

  const sortOrder = await nextSortOrder(db, section)
  const { data, error } = await db
    .from('tasks')
    .insert({ title, notes: notes || null, section, completed: false, sort_order: sortOrder })
    .select('id,created_at,title,notes,section,completed,sort_order')
    .single<Task>()

  if (error) throw error
  return { task: data }
}

async function updateTask(
  db: SupabaseClient,
  args: Record<string, unknown>,
  listedTaskIds: ReadonlySet<string>,
) {
  const taskId = typeof args.task_id === 'string' && /^\d+$/.test(args.task_id) ? args.task_id : ''
  const currentTitle = typeof args.current_title === 'string' ? args.current_title : ''
  const title = args.title === null ? undefined : typeof args.title === 'string' ? args.title.trim() : null
  const notesMode = args.notes_mode
  const notes = args.notes
  const section = args.section
  const completed = args.completed

  if (!taskId) throw new Error('Invalid task ID.')
  if (!listedTaskIds.has(taskId)) {
    throw new Error('The task must be resolved with list_tasks before it can be updated.')
  }
  if (!currentTitle) throw new Error('The current task title is required.')
  if (title === null || (typeof title === 'string' && (!title || title.length > 500))) {
    throw new Error('Task title must be between 1 and 500 characters.')
  }
  if (!['unchanged', 'replace', 'clear'].includes(String(notesMode))) {
    throw new Error('Invalid notes update mode.')
  }
  if (notesMode === 'replace' && (typeof notes !== 'string' || notes.length > 10000)) {
    throw new Error('Replacement task notes must be a string no longer than 10000 characters.')
  }
  if (notesMode !== 'replace' && notes !== null) {
    throw new Error('Task notes must be null unless they are being replaced.')
  }
  if (section !== null && !isSection(section)) throw new Error('Invalid task section.')
  if (completed !== null && typeof completed !== 'boolean') throw new Error('Invalid completion value.')

  const { data: current, error: readError } = await db
    .from('tasks')
    .select('id,created_at,title,notes,section,completed,sort_order')
    .eq('id', taskId)
    .maybeSingle<Task>()

  if (readError) throw readError
  if (!current) throw new Error(`No accessible task exists with ID ${taskId}.`)
  if (current.title !== currentTitle) {
    throw new Error('The task changed after it was listed. Please list the tasks again before updating it.')
  }

  const changes: Record<string, unknown> = {}
  if (title !== undefined) changes.title = title
  if (notesMode === 'replace') changes.notes = notes
  if (notesMode === 'clear') changes.notes = null
  if (section !== null) changes.section = section
  if (completed !== null) changes.completed = completed

  if (Object.keys(changes).length === 0) throw new Error('No task changes were supplied.')

  if (section && section !== current.section) {
    changes.sort_order = await nextSortOrder(db, section)
  }

  const { data, error } = await db
    .from('tasks')
    .update(changes)
    .eq('id', taskId)
    .select('id,created_at,title,notes,section,completed,sort_order')
    .single<Task>()

  if (error) throw error
  return { task: data }
}

async function callOpenAI(input: unknown[]) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        'You are the Regis Dashboard assistant.',
        'Use list_tasks whenever the user asks about their tasks; never invent task data.',
        'Use create_task only when the user clearly asks to add or create a task.',
        'For every request to edit, move, complete, or uncomplete an existing task, first call list_tasks with section null and include_completed true.',
        'Only call update_task with an exact task ID and current title returned by list_tasks earlier in this request.',
        'Resolve the user\'s natural-language task reference from the listed tasks. If no task matches or more than one task could reasonably match, do not update anything; ask the user to identify the task more precisely.',
        'When clarification is needed, ask the user to repeat the requested change with a distinguishing section, title, or notes because conversation history is not retained.',
        'Use update_task only for the change the user requested. Leave every unrelated field unchanged.',
        'Moving a task to a different section automatically places it at the end; never attempt to choose or change sort_order.',
        'The only valid sections are important_today (Important Today), today (Today), and general (General).',
        'Keep replies concise and clearly confirm any created or updated task.',
        'You cannot delete or manually reorder tasks.',
      ].join(' '),
      input,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'none' },
      include: ['reasoning.encrypted_content'],
      store: false,
      max_output_tokens: 800,
    }),
  })

  if (!response.ok) {
    let message = `OpenAI request failed (${response.status}).`
    try {
      const body = await response.json()
      if (typeof body?.error?.message === 'string') message = body.error.message
    } catch {
      // Keep the status-only error when the upstream response is not JSON.
    }
    throw new Error(message)
  }

  return await response.json() as OpenAIResponse
}

function responseText(response: OpenAIResponse) {
  return (response.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('\n')
    .trim()
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'The assistant request failed.'
  return OPENAI_API_KEY ? message.replaceAll(OPENAI_API_KEY, '[redacted]') : message
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    return jsonResponse({ error: 'The assistant is not configured correctly.' }, 500)
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'The assistant API key has not been configured.' }, 500)
  }

  const token = bearerToken(request.headers.get('Authorization'))
  if (!token) return jsonResponse({ error: 'Please sign in to use the assistant.' }, 401)

  const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return jsonResponse({ error: 'Your sign-in has expired. Please sign in again.' }, 401)

  const db = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: { message?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'The request body must be valid JSON.' }, 400)
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return jsonResponse({ error: 'Please enter a message.' }, 400)
  if (message.length > 4000) return jsonResponse({ error: 'The message is too long.' }, 400)

  const input: unknown[] = [{ role: 'user', content: message }]
  let createdTask = false
  let changedTask = false
  const listedTaskIds = new Set<string>()
  let taskListReturnedToModel = false

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await callOpenAI(input)
      const output = response.output ?? []
      input.push(...output)
      const taskListWasAvailable = taskListReturnedToModel
      let listedTasksThisRound = false

      const functionCalls = output.filter((item) => item.type === 'function_call')
      if (functionCalls.length === 0) {
        const reply = responseText(response)
        if (!reply) throw new Error('The assistant returned an empty response.')
        return jsonResponse({ reply, task_created: createdTask, task_changed: changedTask })
      }

      for (const call of functionCalls) {
        if (!call.call_id || !call.name || typeof call.arguments !== 'string') {
          throw new Error('The assistant returned an invalid tool request.')
        }

        let args: Record<string, unknown>
        try {
          args = JSON.parse(call.arguments)
        } catch {
          throw new Error('The assistant returned invalid tool arguments.')
        }

        let result: unknown
        if (call.name === 'list_tasks') {
          const listed = await listTasks(db, args)
          result = listed
          for (const task of listed.tasks) listedTaskIds.add(String(task.id))
          listedTasksThisRound = true
        } else if (call.name === 'create_task') {
          result = await createTask(db, args)
          createdTask = true
          changedTask = true
        } else if (call.name === 'update_task') {
          if (!taskListWasAvailable) {
            throw new Error('The assistant must inspect the list_tasks result before updating a task.')
          }
          result = await updateTask(db, args, listedTaskIds)
          changedTask = true
        } else {
          result = { error: 'Unknown tool.' }
        }

        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        })
      }

      if (listedTasksThisRound) taskListReturnedToModel = true
    }

    return jsonResponse({ error: 'The assistant needed too many steps. Please try a simpler request.' }, 422)
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error) }, 502)
  }
})
