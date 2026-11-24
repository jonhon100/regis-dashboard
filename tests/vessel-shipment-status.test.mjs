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
let saved, failure, rendered = 0, reminder
const modal = {open:false, close(){this.open=false}}
const reminderForm = {}
const context = vm.createContext({
  document: {documentElement:{clientWidth:390,clientHeight:750}},
  $: selector => selector === '#modal' ? modal : reminderForm,
  showModal: markup => {reminder=markup; modal.open=true},
  partsOrders: orders, esc: String, renderModule: () => rendered++, setSync() {},
  alert: message => { failure = message },
  api: async (path, request) => {
    saved = [path, request.method, JSON.parse(request.body)]
    return [saved[2]]
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
const picker = {}, handlers = {}, box = {
  style:{}, offsetHeight:120, querySelector: () => picker, contains: () => false,
  matches(){return this.open}, showPopover(){this.open=true}, hidePopover(){this.open=false},
}
form.querySelector = () => box
form.addEventListener = (name,fn) => {handlers[name]=fn}
form.elements.boat_name.addEventListener = (name,fn) => {handlers[name]=fn}
form.elements.boat_name.focus = () => {}
form.elements.boat_name.getBoundingClientRect = () => ({top:50,bottom:80,left:30})
context.setupVesselSuggestions(form)
handlers.input()
assert.ok(box.open)
assert.equal(box.style.top,'84px')
assert.match(picker.innerHTML, /Next Port: Miami/)
handlers.focusin({target:form.elements.captain_name})
assert.ok(!box.open)
assert.equal(form.elements.captain_name.value, '')
form.refreshVesselSuggestions()
box.onclick({target:{closest: () => ({dataset:{vesselUse:'0'}})}})
assert.ok(!box.open)
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
orders[1].tracking_number=''
await context.changeShipmentStatus({value:'shipped',dataset:{shipmentStatus:'2'}})
assert.match(reminder, /Skip for Now/)
modal.close()
assert.equal(orders[1].shipment_status,'shipped')
assert.ok(context.missingTracking(orders[1]))
assert.match(context.trackingWarning(orders[1]), /Add Tracking Number/)
const feedback={}, submit={}
const trackingForm={isConnected:true,elements:{tracking_number:{value:' TEST-123 '}},querySelector:s=>s==='[type=submit]'?submit:feedback}
await context.saveReminderTracking({preventDefault(){},currentTarget:trackingForm},orders[1])
assert.deepEqual(saved,['/rest/v1/regis_parts_orders?id=eq.2','PATCH',{tracking_number:'TEST-123'}])
assert.equal(orders[1].shipment_status,'shipped')
assert.ok(!context.missingTracking(orders[1]))
orders[1].shipment_status='awaiting_shipment'
reminder=null
await context.changeShipmentStatus({value:'shipped',dataset:{shipmentStatus:'2'}})
assert.equal(reminder,null)
orders[1].shipment_status='awaiting_shipment'
context.api = async () => { throw new Error('Fixture failure') }
await context.saveReminderTracking({preventDefault(){},currentTarget:trackingForm},orders[1])
assert.match(feedback.textContent,/Fixture failure/)
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
