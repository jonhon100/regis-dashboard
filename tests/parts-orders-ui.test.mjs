import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../dist/service-worker.js', import.meta.url), 'utf8')

assert.match(app, /https:\/\/xhxsujytkmmhrtvfvshw\.supabase\.co/)
assert.doesNotMatch(app, /regis-dashboard-mcp|regis-assistant|service_role/i)

for (const table of ['regis_suppliers', 'regis_parts_orders', 'regis_settings']) assert.match(app, new RegExp(table))
for (const field of ['boat_name', 'captain_name', 'flag', 'next_port', 'supplier_name', 'purchase_order_number', 'order_date', 'notes']) assert.match(app, new RegExp(field))
for (const field of ['courier', 'tracking_number', 'shipment_date', 'shipment_status', 'tracking_url']) assert.match(app, new RegExp(field))
for (const status of ['awaiting_shipment', 'shipped', 'broker_prealerted', 'delivered']) assert.match(app, new RegExp(status))
for (const placeholder of ['boat_name', 'captain', 'flag', 'next_port', 'courier', 'tracking_number', 'po_number']) assert.match(app, new RegExp(`\\{${placeholder}\\}`))

assert.match(app, /New Parts Order/)
assert.match(app, /Broker Pre-Alert/)
assert.match(app, /Save as Default/)
assert.match(app, /Copy Email/)
assert.match(app, /Track Shipment/)
assert.match(app, /dhl\.com\/global-en\/home\/tracking\.html\?tracking-id=/)
assert.match(app, /fedex\.com\/fedextrack\/\?trknbr=/)
assert.match(app, /ups\.com\/track\?tracknum=/)
assert.match(app, /resolution=merge-duplicates/)
assert.match(worker, /regis-hub-shell-v2/)

console.log('Parts Orders / Shipments UI isolation and integration checks passed')
