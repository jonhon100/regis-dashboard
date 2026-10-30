import assert from 'node:assert/strict'
import fs from 'node:fs'

const mcp = fs.readFileSync(new URL('../supabase/functions/regis-hub-mcp-dev/index.ts', import.meta.url), 'utf8')
const assistant = fs.readFileSync(new URL('../supabase/functions/regis-hub-assistant-dev/index.ts', import.meta.url), 'utf8')
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')

for (const source of [mcp, assistant]) {
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY/i)
  assert.match(source, /Authorization: `Bearer \$\{token\}`/)
  assert.match(source, /\.from\('outline_documents'\)/)
  assert.match(source, /\.from\('tasks'\)/)
  for (const operation of ['list_documents','list_outline_items','create_outline_item','move_outline_item']) {
    assert.match(source, new RegExp(operation))
  }
}

for (const legacy of ['list_tasks','create_task','update_task']) assert.match(assistant, new RegExp(legacy))
for (const legacy of ['list_tasks','get_task','create_task','update_task','delete_task']) assert.match(mcp, new RegExp(`'${legacy}'`))
for (const outlineOperation of ['delete_outline_item', 'confirm_descendant_count']) assert.match(mcp, new RegExp(outlineOperation))
assert.match(mcp, /'delete_outline_item'[\s\S]*destructiveHint: true/)

assert.match(mcp, /functions\/v1\/regis-hub-mcp-dev/)
assert.doesNotMatch(mcp, /functions\/v1\/regis-dashboard-mcp/)
assert.match(mcp, /\.eq\('document_id', todo\.id\)/)
assert.match(mcp, /\.is\('parent_id', null\)/)
assert.match(mcp, /Moving items between documents is not supported/)
assert.match(mcp, /claims\.iss !== OAUTH_ISSUER/)
assert.match(mcp, /const OAUTH_CLIENT_ID = '[0-9a-f-]+'/)
assert.match(mcp, /claims\.client_id !== OAUTH_CLIENT_ID/)
assert.doesNotMatch(mcp, /regis_dashboard_permissions|REQUIRED_PERMISSIONS/)
assert.match(mcp, /securitySchemes \?\?=/)

assert.match(assistant, /OPENAI_API_KEY/)
assert.match(assistant, /authClient\.auth\.getUser\(token\)/)
assert.match(assistant, /list_outline_items before moving an item/)
assert.match(assistant, /task_changed: changedTask/)

assert.match(config, /\[functions\.regis-hub-mcp-dev\][\s\S]*verify_jwt = false/)
assert.match(config, /\[functions\.regis-hub-assistant-dev\][\s\S]*verify_jwt = true/)
assert.doesNotMatch(config, /regis-dashboard-mcp|regis-assistant/)

assert.match(app, /location\.pathname==='\/oauth\/consent'/)
assert.match(app, /oauth\/authorizations\/'\+encodeURIComponent\(oauthId\)/)
assert.match(app, /JSON\.stringify\(\{action\}\)/)
assert.match(app, /regis-outline-demo\.stlucia913973\.chatgpt\.site|REGIS HUB/)
assert.match(app, /https:\/\/xhxsujytkmmhrtvfvshw\.supabase\.co/)
assert.doesNotMatch(app, /regis-dashboard-mcp|regis-assistant|service_role/i)

console.log('Development Assistant/MCP/OAuth compatibility and isolation tests passed')
