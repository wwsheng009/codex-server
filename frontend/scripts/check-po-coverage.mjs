#!/usr/bin/env node

/**
 * 检查 .po 翻译文件的完整性，找出空翻译条目。
 *
 * 用法: node scripts/check-po-coverage.mjs [locale]
 * 默认检查 zh-CN
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const locale = process.argv[2] || 'zh-CN'
const poPath = join(rootDir, 'src', 'locales', locale, 'messages.po')

let content
try {
  content = readFileSync(poPath, 'utf-8')
} catch {
  console.error(`❌ 找不到翻译文件: ${poPath}`)
  process.exit(1)
}

const entries = []

function createEntry() {
  return {
    msgid: [],
    msgstr: [],
    locations: [],
    isObsolete: false,
    inField: null,
  }
}

function unquotePoString(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value.slice(1, -1)
  }
}

let current = createEntry()

function flushEntry() {
  const msgidStr = current.msgid.join('')
  const msgstrStr = current.msgstr.join('').trim()

  if (msgidStr && !current.isObsolete) {
    entries.push({
      msgid: msgidStr,
      msgstr: msgstrStr,
      location: current.locations.join('; '),
    })
  }

  current = createEntry()
}

for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trimEnd()

  if (!line) {
    flushEntry()
    continue
  }

  if (line.startsWith('#: ')) {
    current.locations.push(line.slice(3))
    continue
  }

  if (line.startsWith('#~')) {
    current.isObsolete = true
    continue
  }

  if (line.startsWith('#')) continue

  if (line.startsWith('msgid ')) {
    current.inField = 'msgid'
    const value = line.slice(6)
    if (value !== '""') {
      current.msgid.push(unquotePoString(value))
    }
    continue
  }

  if (line.startsWith('msgstr ')) {
    current.inField = 'msgstr'
    const value = line.slice(7)
    if (value !== '""') {
      current.msgstr.push(unquotePoString(value))
    }
    continue
  }

  if (line.startsWith('"') && line.endsWith('"')) {
    const value = unquotePoString(line)
    if (current.inField === 'msgid') current.msgid.push(value)
    if (current.inField === 'msgstr') current.msgstr.push(value)
  }
}

flushEntry()

const total = entries.length
const translated = entries.filter((e) => e.msgstr).length
const empty = entries.filter((e) => !e.msgstr)

console.log(`\n翻译文件: ${locale}/messages.po`)
console.log(`有效条目: ${total}`)
console.log(`已翻译:   ${translated} (${total ? ((translated / total) * 100).toFixed(1) : 0}%)`)
console.log(`空翻译:   ${empty.length}`)

if (empty.length === 0) {
  console.log('\n✅ 所有条目均已翻译。')
  process.exit(0)
}

// Group by file
const byFile = new Map()
for (const { location, msgid } of empty) {
  const mainFile = location.split(/\s+/)[0]?.split(':')[0] || 'unknown'
  if (!byFile.has(mainFile)) byFile.set(mainFile, [])
  byFile.get(mainFile).push(msgid)
}

console.log('\n空翻译按文件分布 (Top 30):')
const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [file, items] of sorted.slice(0, 30)) {
  console.log(`  ${file}: ${items.length}`)
}

// Show first 80 empty translations
console.log(`\n空翻译明细 (前 80 条，共 ${empty.length} 条):`)
for (const { location, msgid } of empty.slice(0, 80)) {
  const display = msgid.length > 100 ? msgid.slice(0, 97) + '...' : msgid
  console.log(`  [${location}] ${display}`)
}
if (empty.length > 80) {
  console.log(`  ... 还有 ${empty.length - 80} 条`)
}
