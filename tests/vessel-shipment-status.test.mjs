import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const html = read('dist/index.html')
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1]
new vm.Script(source)
const orders = [
  {id: 1, boat_name: 'Sonora II'},
  {id: 2, boat_name: 'Sonora', captain_name: 'Smith', flag: 'USA', next_port: 'Miami', archived_at: '2026-10-01'},
  {id: 3, boat_name: ' Sonora ', captain_name: 'Jones', flag: 'UK'},
  {id: 4, boat_name: 'SONORA', captain_name: 'smith', flag: 'usa', next_port: 'Miami'},
]
let saved, failure, rendered = 0
const context = vm.createContext({
  partsOrders: orders, esc: String, renderModule: () => rendered++, setSync() {},
  alert: message => { failure = message },
  api: async (path, request) => {
    saved = [path, request.method, JSON.parse(request.body)]
    return [{shipment_status: saved[2].shipment_status}]
  },
})
const start = source.indexOf('const STATUS_LABELS')
const end = source.indexOf('\nconst ', source.indexOf('finally{select.disabled=false}', start))
vm.runInContext(source.slice(start, end) + '\nglobalThis.labels=STATUS_LABELS', context)
assert.deepEqual(Array.from(context.vesselSuggestions('  sOnOrA ', orders), o => o.id), [2, 3, 1])
assert.equal(context.vesselSuggestions('Unknown', orders).length, 0)
const before = JSON.stringify(orders)
const form = {elements: Object.fromEntries(Object.entries({
  boat_name: 'Sonora', captain_name: '', flag: '', next_port: '',
  supplier_name: 'Vendor', purchase_order_number: 'NEW-PO', courier: 'UPS',
  order_date: '2026-11-24', tracking_number: 'NEW-TRACK', notes: 'Imported items',
}).map(([key,value]) => [key,{value}]))}
const picker = {}, dismiss = {}, box = {querySelector: key => key === 'select' ? picker : dismiss}
form.querySelector = () => box
form.elements.boat_name.addEventListener = () => {}
form.elements.boat_name.focus = () => {}
context.setupVesselSuggestions(form)
form.refreshVesselSuggestions()
assert.ok(!box.hidden)
assert.match(picker.innerHTML, /Previous port: Miami/)
dismiss.onclick()
assert.ok(box.hidden)
assert.equal(form.elements.captain_name.value, '')
form.refreshVesselSuggestions()
picker.value = '0'
picker.onchange()
assert.equal(form.elements.boat_name.value, 'Sonora')
assert.equal(form.elements.captain_name.value, 'Smith')
assert.equal(form.elements.flag.value, 'USA')
assert.equal(form.elements.next_port.value, 'Miami')
assert.equal(form.elements.purchase_order_number.value, 'NEW-PO')
assert.equal(form.elements.supplier_name.value, 'Vendor')
assert.equal(form.elements.order_date.value, '2026-11-24')
assert.equal(form.elements.courier.value, 'UPS')
assert.equal(form.elements.tracking_number.value, 'NEW-TRACK')
assert.equal(form.elements.notes.value, 'Imported items')
assert.equal(JSON.stringify(orders), before)
assert.equal(saved, undefined)
assert.match(source, /parsed\[name\];form\.refreshVesselSuggestions\?\.\(\)/)

assert.deepEqual(Object.values(context.labels), ['Awaiting Shipment','Shipped','Awaiting Clearance','Cleared'])
for (const value of ['shipped','broker_prealerted','delivered','awaiting_shipment']) {
  await context.changeShipmentStatus({value,dataset:{shipmentStatus:'2'}})
  assert.equal(saved[0], '/rest/v1/regis_parts_orders?id=eq.2')
  assert.equal(saved[1], 'PATCH')
  assert.equal(saved[2].shipment_status, value)
  assert.equal(saved[2].shipment_status_manual, true)
  assert.equal(orders[1].shipment_status, value)
}
assert.equal(rendered, 4)
context.api = async () => { throw new Error('Fixture failure') }
const select = {value:'shipped',dataset:{shipmentStatus:'2'}}
await context.changeShipmentStatus(select)
assert.equal(failure, 'Fixture failure')
assert.equal(select.value, 'awaiting_shipment')
assert.equal(orders[1].shipment_status, 'awaiting_shipment')
assert.match(source, /function orderCard.*statusBadge\(o\)/)
assert.match(source, /function applyRealtime.*regis_parts_orders.*setTimeout\(loadModules,180\)/)
assert.match(html, /@media\(hover:hover\) and \(pointer:fine\).*scale\(1\.06\)/)
const migration = read('supabase/migrations/20261124010000_preserve_manual_shipment_status.sql')
assert.match(migration, /new\.shipment_status_manual is not true/)
assert.match(migration, /new\.shipment_status = 'awaiting_shipment'/)
assert.match(migration, /nullif\(btrim\(old\.tracking_number\), ''\) is null/)
assert.doesNotMatch(migration, /update public\.regis_parts_orders set/i)
console.log('Vessel matching and mocked shipment status workflows passed')
