import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../dist/service-worker.js', import.meta.url), 'utf8')

// Desktop-only hover remains a transform (no layout reflow), but grows away from the sidebar.
assert.match(app, /@media\(hover:hover\) and \(pointer:fine\)/)
assert.match(app, /transform-origin:left center/)
assert.match(app, /scale\(1\.06\)/)
assert.match(app, /z-index:20/)
assert.match(app, /max-width:min\(1050px,calc\(100% - 72px\)\)/)
assert.doesNotMatch(app, /transform-origin:center/)

// Top-level importer uses the existing review-first form and never saves automatically.
assert.match(app, /data-top-pdf-drop/)
assert.match(app, /data-top-pdf-file/)
assert.match(app, /function setupTopImport\(root\)/)
assert.match(app, /input\.onchange=.*openImportedOrder\(file\)/)
assert.match(app, /drop\.ondrop=.*e\.dataTransfer\.files\?\.\[0\].*openImportedOrder\(file\)/)
assert.match(app, /function openImportedOrder\(file\).*orderForm\(\).*importPurchaseOrder\(file,form\)/)
assert.match(app, /data-pdf-drop/)
const openImport = app.slice(app.indexOf('function openImportedOrder'), app.indexOf('function setupTopImport'))
assert.doesNotMatch(openImport, /saveOrder|api\(/)

// Active Parts Orders and Shipments share the same guarded underlying-row deletion.
assert.match(app, /data-delete-active-order="\$\{o\.id\}"/)
assert.match(app, /function permanentlyDeleteActiveOrder\(o\)/)
assert.match(app, /if\(!confirm\(`Permanently delete \$\{identity\}\?/) 
assert.match(app, /regis_parts_orders\?id=eq\.'\+o\.id,\{method:'DELETE'\}/)
assert.match(app, /removed from both views/)
assert.match(app, /async function archiveOrder\(o\)/)
assert.match(app, /async function restoreOrder\(o\)/)

// Every main view uses one naturally scrollable content pane; dialogs scroll internally.
assert.match(app, /main\{min-width:0;min-height:0;/)
assert.match(app, /\.content\{overflow-y:auto;overflow-x:hidden;min-height:0;flex:1 1 auto;/)
assert.match(app, /height:100dvh/)
assert.match(app, /-webkit-overflow-scrolling:touch/)
assert.match(app, /\.formbody\{padding:12px 15px;overflow-y:auto;min-height:0\}/)
assert.doesNotMatch(app, /document\.body\.style\.overflow|documentElement\.style\.overflow/)

// Status remains right-aligned in the flex row, but is larger and vertically centred.
assert.match(app, /\.record-main\{display:flex;align-items:center;/)
assert.match(app, /\.status\{display:inline-block;align-self:center;[^}]*padding:5px 11px;[^}]*font-size:12\.5px;font-weight:720/)
assert.match(worker, /regis-hub-shell-v6/)

console.log('REGIS HUB workflow refinement UI checks passed')
