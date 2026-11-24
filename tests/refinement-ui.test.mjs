import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const app = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/20261124000000_add_parts_orders_archive.sql', import.meta.url), 'utf8')
const rollback = fs.readFileSync(new URL('../supabase/rollback/20261124000000_add_parts_orders_archive.down.sql', import.meta.url), 'utf8')

assert.match(migration, /add column if not exists archived_at timestamptz/)
assert.match(migration, /regis_parts_orders_user_archived_idx/)
assert.match(rollback, /drop column if exists archived_at/)
assert.doesNotMatch(migration, /delete\s+from|truncate/i)

assert.match(app, /function visibleItemIds\(\)/)
assert.match(app, /remove\(x,true,true\)/)
assert.match(app, /state\.selected=focusPrevious\?previous:null/)
assert.match(app, /function deleteCrossItemSelection\(e\)/)
assert.match(app, /task rows retained for safety/)
assert.match(app, /data-module="archived"/)
assert.match(app, /data-archive-search/)
assert.match(app, /async function archiveOrder\(o\)/)
assert.match(app, /async function restoreOrder\(o\)/)
assert.match(app, /async function permanentlyDeleteOrder\(o\)/)
assert.match(app, /This cannot be undone/)
assert.match(app, /@media\(hover:hover\) and \(pointer:fine\)/)
assert.match(app, /transform:translateY\(-4px\) scale\(1\.06\)/)
assert.match(app, /transform-origin:left center/)
assert.match(app, /box-shadow:0 18px 42px/)
assert.match(app, /Import Purchase Order PDF/)
assert.match(app, /never uploaded or saved/)
assert.match(app, /Review every field, then press Save order/)

const start = app.indexOf('function poDate')
const end = app.indexOf('async function importPurchaseOrder', start)
const context = {}
vm.createContext(context)
vm.runInContext(app.slice(start, end) + ';globalThis.parse=parsePurchaseOrder', context)
const parsed = context.parse([
  'PURCHASE ORDER',
  'Date: 23 November 26',
  'PO: SLU2611-07',
  'TO: Raymarine',
  'SHIP VIA: DHL',
  '1',
  'T70161 EV-400 Sail Autopilot',
  'TOTAL 1,959.99',
  'SHIP TO: Vessel in transit "Lady Blue"',
].join('\n'))
assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
  boat_name: 'Lady Blue',
  supplier_name: 'Raymarine',
  purchase_order_number: 'SLU2611-07',
  order_date: '2026-11-23',
  courier: 'DHL',
  order_details: '1 × T70161 EV-400 Sail Autopilot — 1,959.99',
})

console.log('REGIS HUB refinement, archive, and PO import checks passed')
