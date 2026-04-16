import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const DEFAULTS = {
  root: 'src',
  localesRoot: 'src/locales',
  extensions: ['.tsx', '.jsx', '.ts', '.js'],
  exclude: ['node_modules', 'dist', 'coverage', '.git', 'build', '.next', 'tmp'],
  ignore: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
  config: 'i18n-check.config.mjs',
  report: 'console',
  output: '',
  minLength: 1,
  includeObjectProps: true,
  checkEmptyMsgstr: true,
  failOnIssues: false,
}

const TRANS_ATTR_NAMES = new Set([
  'title',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'label',
  'helpertext',
  'emptytext',
  'tooltip',
  'prompt',
  'summary',
  'description',
  'heading',
  'caption',
  'confirmtext',
  'canceltext',
])

const TRANS_PROP_NAMES = new Set([
  'title',
  'label',
  'text',
  'message',
  'placeholder',
  'description',
  'summary',
  'tooltip',
  'caption',
  'heading',
  'confirmtext',
  'canceltext',
  'emptytext',
  'helpertext',
  'subtitle',
  'content',
])

const NON_UI_ATTR_NAMES = new Set([
  'class',
  'classname',
  'id',
  'role',
  'type',
  'key',
  'name',
  'value',
  'variant',
  'size',
  'color',
  'href',
  'src',
  'to',
  'path',
  'rel',
  'target',
  'method',
  'autocomplete',
  'autocapitalize',
  'spellcheck',
  'inputmode',
  'pattern',
  'for',
  'form',
  'tabindex',
  'viewbox',
  'xmlns',
  'stroke',
  'fill',
  'd',
  'x',
  'y',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
])

const I18N_COMPONENTS = new Set(['Trans'])
const I18N_TAGS = new Set(['t', 'msg'])
const I18N_CALLEES = [/\bi18n\._$/, /\bi18n\.t$/, /^t$/, /^msg$/, /^_$/]
const DEFAULT_SENTENCE_RE = /[\p{sc=Han}]|[A-Za-z].*\s+[A-Za-z]|[A-Za-z]{3,}[.!?…:]?$/u

function parseArgs(argv) {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const key = rawKey.trim()
    const nextValue = inlineValue ?? argv[index + 1]

    switch (key) {
      case 'root':
        options.root = inlineValue ?? nextValue
        if (inlineValue == null) index += 1
        break
      case 'extensions':
        options.extensions = splitCsv(inlineValue ?? nextValue).map(normalizeExt)
        if (inlineValue == null) index += 1
        break
      case 'locales-root':
        options.localesRoot = inlineValue ?? nextValue
        if (inlineValue == null) index += 1
        break
      case 'exclude':
        options.exclude = splitCsv(inlineValue ?? nextValue)
        if (inlineValue == null) index += 1
        break
      case 'ignore':
        options.ignore = splitCsv(inlineValue ?? nextValue)
        if (inlineValue == null) index += 1
        break
      case 'report':
        options.report = inlineValue ?? nextValue
        if (inlineValue == null) index += 1
        break
      case 'config':
        options.config = inlineValue ?? nextValue
        if (inlineValue == null) index += 1
        break
      case 'output':
        options.output = inlineValue ?? nextValue
        if (inlineValue == null) index += 1
        break
      case 'min-length':
        options.minLength = Number(inlineValue ?? nextValue)
        if (inlineValue == null) index += 1
        break
      case 'include-object-props':
        options.includeObjectProps = parseBoolean(inlineValue ?? nextValue)
        if (inlineValue == null) index += 1
        break
      case 'check-empty-msgstr':
        options.checkEmptyMsgstr = inlineValue == null ? true : parseBoolean(inlineValue)
        if (inlineValue == null) break
        break
      case 'fail-on-issues':
        options.failOnIssues = inlineValue == null ? true : parseBoolean(inlineValue)
        break
      case 'help':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: --${key}`)
    }
  }

  if (!Number.isFinite(options.minLength) || options.minLength < 1) {
    throw new Error('--min-length must be a positive number')
  }

  options.extensions = [...new Set(options.extensions)]
  return options
}

function splitCsv(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeExt(value) {
  return value.startsWith('.') ? value : `.${value}`
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new Error(`Invalid boolean value: ${value}`)
}

function printHelp() {
  console.log(`Missing i18n scanner\n\nUsage:\n  node ./scripts/check-missing-i18n.mjs [options]\n\nOptions:\n  --root <path>                  Scan root directory, default: src\n  --extensions <csv>             File extensions, default: .tsx,.jsx,.ts,.js\n  --locales-root <path>          Locale root for .po checks, default: src/locales\n  --exclude <csv>                Directory names to skip\n  --ignore <csv>                 Glob-like path patterns to skip\n  --config <file>                Whitelist config file, default: i18n-check.config.mjs\n  --report <console|json|md>     Report format, default: console\n  --output <file>                Write report to file\n  --min-length <n>               Minimum visible text length, default: 1\n  --include-object-props <bool>  Scan object literal UI props, default: true\n  --check-empty-msgstr <bool>    Warn when msgstr is empty, default: true\n  --fail-on-issues               Exit with code 1 when issues exist\n  --help                         Show this help\n`)
}

function listFiles(rootDir, options) {
  const collected = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      const relativePath = normalizePath(path.relative(process.cwd(), fullPath))

      if (entry.isDirectory()) {
        if (options.exclude.includes(entry.name)) continue
        if (matchesIgnore(relativePath, options.ignore)) continue
        stack.push(fullPath)
        continue
      }

      if (!options.extensions.includes(path.extname(entry.name))) continue
      if (matchesIgnore(relativePath, options.ignore)) continue
      collected.push(fullPath)
    }
  }

  return collected.sort((a, b) => a.localeCompare(b))
}

function listPoFiles(localesRoot) {
  if (!fs.existsSync(localesRoot)) return []

  const collected = []
  const stack = [localesRoot]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (path.extname(entry.name) === '.po') {
        collected.push(fullPath)
      }
    }
  }

  return collected.sort((a, b) => a.localeCompare(b))
}

function normalizePath(value) {
  return value.split(path.sep).join('/')
}

function matchesIgnore(relativePath, patterns) {
  return patterns.some((pattern) => matchGlob(relativePath, pattern))
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function matchGlob(input, pattern) {
  const regexText = `^${pattern
    .split('**')
    .map((part) => part.split('*').map(escapeRegex).join('[^/]*'))
    .join('.*')}$`
  return new RegExp(regexText).test(input)
}

async function loadWhitelistConfig(configPath) {
  const fullPath = path.resolve(process.cwd(), configPath)
  if (!fs.existsSync(fullPath)) {
    return {
      path: normalizePath(path.relative(process.cwd(), fullPath)),
      exists: false,
      files: [],
      texts: [],
      textPatterns: [],
      entries: [],
    }
  }

  const loaded = await import(pathToFileUrl(fullPath))
  const config = loaded.default ?? loaded
  return {
    path: normalizePath(path.relative(process.cwd(), fullPath)),
    exists: true,
    files: normalizeArray(config.files),
    texts: normalizeArray(config.texts),
    textPatterns: compileRegexList(config.textPatterns),
    entries: normalizeWhitelistEntries(config.entries),
  }
}

function pathToFileUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  return `file:///${normalized}`
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function compileRegexList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => compileRegex(item, 'textPatterns'))
}

function normalizeWhitelistEntries(value) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => ({
    file: item.file ? String(item.file) : '',
    filePattern: item.filePattern ? String(item.filePattern) : '',
    kind: item.kind ? String(item.kind) : '',
    attribute: item.attribute ? String(item.attribute) : '',
    property: item.property ? String(item.property) : '',
    text: item.text ? String(item.text) : '',
    textPattern: item.textPattern ? compileRegex(item.textPattern, `entries[${index}].textPattern`) : null,
    reason: item.reason ? String(item.reason) : '',
  }))
}

function compileRegex(value, fieldName) {
  if (value instanceof RegExp) return value
  if (typeof value !== 'string' || !value.startsWith('/') || value.lastIndexOf('/') === 0) {
    throw new Error(`Invalid regex in whitelist config: ${fieldName}`)
  }
  const lastSlash = value.lastIndexOf('/')
  return new RegExp(value.slice(1, lastSlash), value.slice(lastSlash + 1))
}

function scanFile(filePath, options, whitelistConfig) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  const scriptKind = resolveScriptKind(filePath)
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const findings = []
  const relativeFile = normalizePath(path.relative(process.cwd(), filePath))

  function pushFinding(node, kind, text, meta = {}) {
    const normalizedText = normalizeVisibleText(text)
    if (!normalizedText) return
    if (normalizedText.length < options.minLength) return
    if (!looksHumanText(normalizedText)) return
    if (isInI18nContext(node)) return
    if (isWhitelisted(whitelistConfig, relativeFile, kind, normalizedText, meta)) return

    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    findings.push({
      file: relativeFile,
      line: start.line + 1,
      column: start.character + 1,
      kind,
      text: normalizedText,
      snippet: createSnippet(sourceText, node.getStart(sourceFile), node.getEnd()),
      ...meta,
    })
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      pushFinding(node, 'jsx-text', node.getText(sourceFile))
    }

    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.text.toLowerCase()
      if (NON_UI_ATTR_NAMES.has(attrName) && !TRANS_ATTR_NAMES.has(attrName)) {
        return ts.forEachChild(node, visit)
      }

      const value = getLiteralLikeText(node.initializer)
      if (value && TRANS_ATTR_NAMES.has(attrName)) {
        pushFinding(node, 'jsx-attribute', value, { attribute: node.name.text })
      }
    }

    if (ts.isJsxExpression(node)) {
      const value = getLiteralLikeText(node.expression)
      if (value) {
        pushFinding(node, 'jsx-expression', value)
      }
    }

    if (options.includeObjectProps && ts.isPropertyAssignment(node)) {
      const propName = getPropertyName(node.name)?.toLowerCase()
      if (propName && TRANS_PROP_NAMES.has(propName)) {
        const value = getLiteralLikeText(node.initializer)
        if (value) {
          pushFinding(node, 'object-property', value, { property: getPropertyName(node.name) })
        }
      }
    }

    if (isStandaloneTextNode(node) && !isHandledBySpecificRule(node) && !isIgnoredLiteralContext(node)) {
      const candidate = getStandaloneText(node, sourceFile)
      if (candidate) {
        const meta = getStandaloneTextMeta(node)
        pushFinding(node, meta.kind, candidate, meta.details)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

function scanPoFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const relativeFile = normalizePath(path.relative(process.cwd(), filePath))
  const locale = path.basename(path.dirname(filePath))
  const findings = []
  const lines = content.split(/\r?\n/)
  let entry = createPoEntry()

  function flushEntry() {
    const msgidText = entry.msgid.join('')
    const msgstrText = entry.msgstr.join('').trim()

    if (!msgidText || entry.isObsolete || msgstrText) {
      entry = createPoEntry()
      return
    }

    findings.push({
      file: relativeFile,
      line: entry.msgstrLine || entry.msgidLine || 1,
      column: 1,
      kind: 'po-empty-msgstr',
      text: normalizeVisibleText(msgidText),
      snippet: normalizeVisibleText(entry.lines.join('\n')).slice(0, 160),
      locale,
      location: entry.location,
    })

    entry = createPoEntry()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.trimEnd()
    const lineNumber = index + 1

    if (!line) {
      flushEntry()
      continue
    }

    entry.lines.push(rawLine)

    if (line.startsWith('#: ')) {
      entry.location = entry.location ? `${entry.location}; ${line.slice(3)}` : line.slice(3)
      continue
    }

    if (line.startsWith('#~')) {
      entry.isObsolete = true
      continue
    }

    if (line.startsWith('#')) continue

    if (line.startsWith('msgid ')) {
      entry.inField = 'msgid'
      entry.msgidLine = lineNumber
      const value = line.slice(6)
      if (value !== '""') {
        entry.msgid.push(unquotePoString(value))
      }
      continue
    }

    if (line.startsWith('msgstr ')) {
      entry.inField = 'msgstr'
      entry.msgstrLine = lineNumber
      const value = line.slice(7)
      if (value !== '""') {
        entry.msgstr.push(unquotePoString(value))
      }
      continue
    }

    if (line.startsWith('"') && line.endsWith('"')) {
      const value = unquotePoString(line)
      if (entry.inField === 'msgid') entry.msgid.push(value)
      if (entry.inField === 'msgstr') entry.msgstr.push(value)
    }
  }

  flushEntry()

  return findings
}

function createPoEntry() {
  return {
    msgid: [],
    msgstr: [],
    location: '',
    isObsolete: false,
    inField: null,
    msgidLine: 0,
    msgstrLine: 0,
    lines: [],
  }
}

function resolveScriptKind(filePath) {
  const extension = path.extname(filePath)
  if (extension === '.tsx') return ts.ScriptKind.TSX
  if (extension === '.jsx') return ts.ScriptKind.JSX
  if (extension === '.js') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function unquotePoString(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value.slice(1, -1)
  }
}

function getLiteralLikeText(node) {
  if (!node) return ''
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isJsxExpression(node)) return getLiteralLikeText(node.expression)
  if (ts.isParenthesizedExpression(node)) return getLiteralLikeText(node.expression)
  return ''
}

function isStandaloneTextNode(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  )
}

function isHandledBySpecificRule(node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isJsxAttribute(parent) && parent.initializer === node) return true
  if (ts.isJsxExpression(parent) && parent.expression === node) return true
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const propName = getPropertyName(parent.name)?.toLowerCase()
    return Boolean(propName && TRANS_PROP_NAMES.has(propName))
  }
  return false
}

function getStandaloneText(node, sourceFile) {
  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text]
    for (const span of node.templateSpans) {
      parts.push('${…}')
      parts.push(span.literal.text)
    }
    return parts.join('')
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return node.getText(sourceFile)
}

function getStandaloneTextMeta(node) {
  const parent = node.parent
  if (parent && ts.isArrayLiteralExpression(parent)) {
    return { kind: 'array-element', details: {} }
  }

  if (parent && ts.isPropertyAssignment(parent)) {
    return {
      kind: 'object-property',
      details: { property: getPropertyName(parent.name) },
    }
  }

  if (parent && ts.isVariableDeclaration(parent)) {
    return {
      kind: 'variable-initializer',
      details: { property: getPropertyName(parent.name) },
    }
  }

  if (parent && ts.isReturnStatement(parent)) {
    return { kind: 'return-literal', details: {} }
  }

  return { kind: 'literal', details: {} }
}

function getPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text
  }
  return undefined
}

function normalizeVisibleText(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function looksHumanText(value) {
  if (!value) return false
  if (/[\p{sc=Han}]/u.test(value)) return true
  if (/^[#./:_-]+$/.test(value)) return false
  if (/^[a-z0-9-]+$/i.test(value) && !/[A-Z]/.test(value) && value.length <= 2) return false
  if (/^[A-Z0-9_:-]+$/.test(value)) return false
  if (/^[a-z0-9-]+$/.test(value) && value.includes('-')) return false
  if (/^([a-z]+\.)+[a-z]+$/i.test(value)) return false
  if (/^\/[\w./:-]+$/i.test(value)) return false
  if (/^\\[\w.\\/-]+$/i.test(value)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false
  if (/^[\w.-]+\/[\w.+-]+$/.test(value)) return false
  if (/^[\w.-]+(?:[\/\\][\w.-]+)+$/.test(value)) return false
  if (/^[a-z]:[\\/]/i.test(value)) return false
  if (/^[a-z]:\/[\w./-]+$/i.test(value)) return false
  if (/^[a-z0-9_]+$/i.test(value) && value.includes('_')) return false
  if (/^[a-z]:\\/i.test(value)) return false
  if (/^[.\w/-]+\.[a-z0-9]+$/i.test(value)) return false
  if (/^\.[a-z0-9]+$/i.test(value)) return false
  if (/^\+[a-z0-9]+$/i.test(value)) return false
  if (/^(true|false|null|undefined)$/i.test(value)) return false
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return false
  if (/^\d+$/.test(value)) return false
  if (/^[\w.-]+:[\w./-]*$/i.test(value) && !/\s/.test(value)) return false
  if (/\[(?:tabindex|disabled|role|aria-)[^\]]*\]|:not\(/i.test(value)) return false
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(value)) return false
  if (/^[a-z]+(?:\s+[a-z]+)+$/i.test(value) && !/\b[A-Z]/.test(value)) return false
  if (/^(top|bottom|left|right|center)(\s+(top|bottom|left|right|center))+$/i.test(value)) return false
  if (/^[a-z]+(?:\.[a-z]+)+$/i.test(value)) return false
  if (/[(){};]/.test(value) && /(color-mix|minmax|max-content|min-content|repeat|linear-gradient|rgba?|hsla?|var)\s*\(/i.test(value)) return false
  if (/__|--/.test(value)) return false
  if (/^[a-z]+$/.test(value)) return false
  if (/^[A-Z][A-Za-z]+$/.test(value)) return true
  if (/[A-Za-z].*\s+[A-Za-z]/.test(value)) return true
  return DEFAULT_SENTENCE_RE.test(value)
}

function isIgnoredLiteralContext(node) {
  const parent = node.parent
  if (!parent) return false

  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  ) {
    return true
  }

  if (ts.isExternalModuleReference(parent) && parent.expression === node) {
    return true
  }

  if (ts.isLiteralTypeNode(parent)) {
    return true
  }

  if (ts.isCaseClause(parent) && parent.expression === node) {
    return true
  }

  if (ts.isJsxAttribute(parent)) {
    const attrName = parent.name.text.toLowerCase()
    if (!TRANS_ATTR_NAMES.has(attrName)) {
      return true
    }
  }

  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const propName = getPropertyName(parent.name)?.toLowerCase()
    if (propName && NON_UI_ATTR_NAMES.has(propName) && !TRANS_PROP_NAMES.has(propName)) {
      return true
    }
  }

  if (ts.isCallExpression(parent)) {
    const calleeText = parent.expression.getText()
    if (calleeText === 'import' || calleeText === 'require') {
      return true
    }

    if (/\.addEventListener$|\.removeEventListener$/.test(calleeText)) {
      return true
    }
  }

  if (ts.isBinaryExpression(parent) && (parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
    return true
  }

  return false
}

function isInI18nContext(node) {
  let current = node
  while (current) {
    if (ts.isTaggedTemplateExpression(current)) {
      const tagText = current.tag.getText()
      if (I18N_TAGS.has(tagText)) return true
    }

    if (ts.isCallExpression(current)) {
      const calleeText = current.expression.getText()
      if (I18N_CALLEES.some((pattern) => pattern.test(calleeText))) return true
    }

    if (ts.isJsxElement(current)) {
      const tagName = current.openingElement.tagName.getText()
      if (I18N_COMPONENTS.has(tagName)) return true
    }

    if (ts.isJsxSelfClosingElement(current)) {
      const tagName = current.tagName.getText()
      if (I18N_COMPONENTS.has(tagName)) return true
    }

    current = current.parent
  }

  return false
}

function createSnippet(sourceText, start, end) {
  const raw = sourceText.slice(start, end)
  return normalizeVisibleText(raw).slice(0, 160)
}

function isWhitelisted(whitelistConfig, file, kind, text, meta) {
  if (whitelistConfig.files.some((pattern) => matchGlob(file, pattern))) {
    return true
  }

  if (whitelistConfig.texts.includes(text)) {
    return true
  }

  if (whitelistConfig.textPatterns.some((pattern) => pattern.test(text))) {
    return true
  }

  return whitelistConfig.entries.some((entry) => {
    if (entry.file && entry.file !== file) return false
    if (entry.filePattern && !matchGlob(file, entry.filePattern)) return false
    if (entry.kind && entry.kind !== kind) return false
    if (entry.attribute && entry.attribute !== meta.attribute) return false
    if (entry.property && entry.property !== meta.property) return false
    if (entry.text && entry.text !== text) return false
    if (entry.textPattern && !entry.textPattern.test(text)) return false
    return true
  })
}

function buildSummary(findings, scannedFiles, root, whitelistConfig) {
  const byFile = new Map()
  for (const finding of findings) {
    byFile.set(finding.file, (byFile.get(finding.file) ?? 0) + 1)
  }

  return {
    scannedRoot: normalizePath(root),
    scannedFiles,
    issueCount: findings.length,
    affectedFiles: byFile.size,
    whitelistConfig: whitelistConfig.path,
    whitelistEnabled: whitelistConfig.exists,
    files: [...byFile.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  }
}

function renderConsole(summary, findings) {
  const lines = []
  lines.push(`扫描目录: ${summary.scannedRoot}`)
  lines.push(`扫描文件: ${summary.scannedFiles}`)
  lines.push(`问题数量: ${summary.issueCount}`)
  lines.push(`影响文件: ${summary.affectedFiles}`)
  lines.push(`白名单配置: ${summary.whitelistEnabled ? summary.whitelistConfig : `${summary.whitelistConfig} (未找到)`}`)
  lines.push('')

  if (summary.issueCount === 0) {
    lines.push('未发现疑似未国际化文本或空翻译条目。')
    return lines.join('\n')
  }

  lines.push('文件汇总:')
  for (const item of summary.files) {
    lines.push(`- ${item.file}: ${item.count}`)
  }
  lines.push('')
  lines.push('问题明细:')
  for (const finding of findings) {
    const meta = finding.attribute
      ? ` attribute=${finding.attribute}`
      : finding.property
        ? ` property=${finding.property}`
        : finding.locale
          ? ` locale=${finding.locale}${finding.location ? ` location=${finding.location}` : ''}`
          : ''
    lines.push(`- ${finding.file}:${finding.line}:${finding.column} [${finding.kind}${meta}] ${finding.text}`)
  }
  return lines.join('\n')
}

function renderMarkdown(summary, findings) {
  const lines = []
  lines.push('# Missing i18n Report')
  lines.push('')
  lines.push(`- 扫描目录: ${summary.scannedRoot}`)
  lines.push(`- 扫描文件: ${summary.scannedFiles}`)
  lines.push(`- 问题数量: ${summary.issueCount}`)
  lines.push(`- 影响文件: ${summary.affectedFiles}`)
  lines.push(`- 白名单配置: ${summary.whitelistEnabled ? summary.whitelistConfig : `${summary.whitelistConfig} (未找到)`}`)
  lines.push('')
  lines.push('## 文件汇总')
  lines.push('')
  lines.push('| 文件 | 数量 |')
  lines.push('| --- | ---: |')
  for (const item of summary.files) {
    lines.push(`| ${item.file} | ${item.count} |`)
  }
  lines.push('')
  lines.push('## 问题明细')
  lines.push('')
  lines.push('| 文件 | 行 | 类型 | 文本 | 备注 |')
  lines.push('| --- | ---: | --- | --- | --- |')
  for (const finding of findings) {
    const note = finding.attribute
      ? `attribute=${finding.attribute}`
      : finding.property
        ? `property=${finding.property}`
        : finding.locale
          ? `locale=${finding.locale}${finding.location ? `; location=${finding.location}` : ''}`
          : ''
    lines.push(`| ${finding.file} | ${finding.line} | ${finding.kind} | ${escapeMd(finding.text)} | ${escapeMd(note)} |`)
  }
  return lines.join('\n')
}

function escapeMd(value) {
  return String(value).replace(/\|/g, '\\|')
}

function renderJson(summary, findings) {
  return JSON.stringify({ summary, findings }, null, 2)
}

function writeReport(outputPath, content) {
  const fullPath = path.resolve(process.cwd(), outputPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const rootDir = path.resolve(process.cwd(), options.root)
  const localesRoot = path.resolve(process.cwd(), options.localesRoot)
  const whitelistConfig = await loadWhitelistConfig(options.config)

  if (!fs.existsSync(rootDir)) {
    throw new Error(`Scan root does not exist: ${rootDir}`)
  }

  const files = listFiles(rootDir, options)
  const codeFindings = files.flatMap((filePath) => scanFile(filePath, options, whitelistConfig))
  const poFindings = options.checkEmptyMsgstr
    ? listPoFiles(localesRoot).flatMap((filePath) => scanPoFile(filePath))
    : []
  const findings = [...codeFindings, ...poFindings]
  const summary = buildSummary(findings, files.length, rootDir, whitelistConfig)

  let report = ''
  if (options.report === 'json') {
    report = renderJson(summary, findings)
  } else if (options.report === 'md') {
    report = renderMarkdown(summary, findings)
  } else if (options.report === 'console') {
    report = renderConsole(summary, findings)
  } else {
    throw new Error(`Unsupported report format: ${options.report}`)
  }

  if (options.output) {
    writeReport(options.output, report)
    console.log(`Report written to ${normalizePath(path.relative(process.cwd(), path.resolve(process.cwd(), options.output)))}`)
  }

  if (!options.output || options.report === 'console') {
    console.log(report)
  }

  if (options.failOnIssues && findings.length > 0) {
    process.exitCode = 1
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
