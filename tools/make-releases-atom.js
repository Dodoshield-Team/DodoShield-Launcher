// Builds releases.atom (the feed the launcher reads for release notes) from CHANGELOG.md.
// Usage: node tools/make-releases-atom.js > dist/releases.atom
const fs = require('fs')
const path = require('path')

const REPO = 'https://github.com/Sebastian-xD/DodoShield-Launcher'
const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const entries = []
let cur = null
for (const line of md.split(/\r?\n/)) {
    const h = /^## (\d+\.\d+\.\d+)/.exec(line)
    if (h) { cur = { version: h[1], items: [] }; entries.push(cur); continue }
    const li = /^- (.+)/.exec(line)
    if (li && cur) cur.items.push(li[1])
}

const now = new Date().toISOString()
let out = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:launcher.dodoshield.com,2026:releases</id>
  <title>DodoShield Launcher releases</title>
  <updated>${now}</updated>
  <link href="${REPO}/blob/main/CHANGELOG.md"/>
`
for (const e of entries) {
    const html = '<ul>' + e.items.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>'
    out += `  <entry>
    <id>tag:launcher.dodoshield.com,2026:release/v${e.version}</id>
    <title>Версія ${e.version}</title>
    <updated>${now}</updated>
    <link href="${REPO}/blob/main/CHANGELOG.md"/>
    <content type="html">${esc(html)}</content>
  </entry>
`
}
out += '</feed>\n'
process.stdout.write(out)
