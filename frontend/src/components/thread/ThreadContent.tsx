import { AnsiUp } from 'ansi_up'
import { useMemo } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { ThreadContentBlockProps } from './threadContentTypes'

const CHANNEL_NOTE_PATTERN = /(?:^|\n)\[(?:Channel note: this conversation is on (?:WeChat|Telegram)\.[^\]]*)]\s*(?=\n|$)/gi
const ATTACHMENT_FENCE_BLOCK_PATTERN =
  /(?:^|\n)```((?:wechat|telegram)-attachments)[^\S\n]*\n([\s\S]*?)```(?=\n|$)/gi
const ATTACHMENT_HEADING_FENCE_BLOCK_PATTERN =
  /(?:^|\n)\s*((?:wechat|telegram)-attachments)\s*:?\s*\n```(?:[\w-]+)?\s*\n([\s\S]*?)```(?=\n|$)/gi
const ATTACHMENT_KINDS = new Set(['media', 'image', 'video', 'file', 'voice'])

const markdownComponents: Components = {
  a({ node: _node, href, rel, ...props }) {
    const isLocalAnchor = typeof href === 'string' && href.startsWith('#')

    return (
      <a
        {...props}
        href={href}
        rel={isLocalAnchor ? rel : 'noreferrer noopener'}
        target={isLocalAnchor ? undefined : '_blank'}
      />
    )
  },
}

export function ThreadMarkdown({
  content,
  className,
}: ThreadContentBlockProps) {
  const sanitizedContent = sanitizeThreadMarkdownContent(content)

  if (!sanitizedContent) {
    return null
  }

  return (
    <div className={joinClassNames('thread-markdown', className)}>
      <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {sanitizedContent}
      </Markdown>
    </div>
  )
}

export function ThreadCodeBlock({
  content,
  className,
}: ThreadContentBlockProps) {
  if (!content) {
    return null
  }

  return (
    <pre className={joinClassNames('thread-code-block', className)}>
      <code>{content}</code>
    </pre>
  )
}

export function ThreadPlainText({
  content,
  className,
}: ThreadContentBlockProps) {
  if (!content) {
    return null
  }

  return <div className={joinClassNames('thread-plain-text', className)}>{content}</div>
}

export function ThreadTerminalBlock({
  content,
  className,
}: ThreadContentBlockProps) {
  const html = useMemo(() => renderAnsiHtml(content), [content])

  if (!content) {
    return null
  }

  return (
    <pre className={joinClassNames('thread-code-block', 'thread-code-block--terminal', className)}>
      <code className="thread-code-block__terminal-content" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

function renderAnsiHtml(value: string) {
  const renderer = new AnsiUp()
  renderer.escape_html = true
  renderer.use_classes = false
  return renderer.ansi_to_html(value)
}

export function sanitizeThreadMarkdownContent(value: string) {
  if (!value.trim()) {
    return ''
  }

  const normalized = value.replace(/\r\n/g, '\n')
  const attachments: ThreadProtocolAttachment[] = []

  let sanitized = extractAttachmentBlocks(
    normalized,
    ATTACHMENT_HEADING_FENCE_BLOCK_PATTERN,
    attachments,
  )
  sanitized = extractAttachmentBlocks(sanitized, ATTACHMENT_FENCE_BLOCK_PATTERN, attachments)
  sanitized = extractAttachmentHeadingLines(sanitized, attachments)
  sanitized = sanitized.replace(CHANNEL_NOTE_PATTERN, '\n')
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim()

  const attachmentSummary = buildAttachmentSummaryMarkdown(attachments)
  if (!sanitized) {
    return attachmentSummary
  }
  if (!attachmentSummary) {
    return sanitized
  }
  return `${sanitized}\n\n${attachmentSummary}`
}

function joinClassNames(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(' ')
}

type ThreadProtocolAttachment = {
  kind: string
  location: string
}

function extractAttachmentBlocks(
  value: string,
  pattern: RegExp,
  attachments: ThreadProtocolAttachment[],
) {
  return value.replace(pattern, (_match, _protocol: string, body: string) => {
    attachments.push(...parseAttachmentLines(body))
    return '\n'
  })
}

function extractAttachmentHeadingLines(
  value: string,
  attachments: ThreadProtocolAttachment[],
) {
  const lines = value.split('\n')
  const visibleLines: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim().toLowerCase()
    if (trimmed !== 'wechat-attachments' && trimmed !== 'wechat-attachments:' && trimmed !== 'telegram-attachments' && trimmed !== 'telegram-attachments:') {
      visibleLines.push(line)
      continue
    }

    const blockLines: string[] = []
    let next = index + 1
    for (; next < lines.length; next += 1) {
      const candidate = lines[next].trim()
      if (candidate === '') {
        if (blockLines.length > 0) {
          next += 1
        }
        break
      }
      if (candidate.startsWith('#') || isAttachmentSpecLine(candidate)) {
        blockLines.push(lines[next])
        continue
      }
      break
    }

    if (blockLines.length === 0) {
      visibleLines.push(line)
      continue
    }

    attachments.push(...parseAttachmentLines(blockLines.join('\n')))
    index = next - 1
  }

  return visibleLines.join('\n')
}

function parseAttachmentLines(block: string) {
  const attachments: ThreadProtocolAttachment[] = []
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const attachment = parseAttachmentSpec(trimmed)
    if (attachment) {
      attachments.push(attachment)
    }
  }
  return attachments
}

function isAttachmentSpecLine(line: string) {
  const [kind] = line.trim().split(/\s+/, 1)
  return ATTACHMENT_KINDS.has((kind ?? '').toLowerCase())
}

function parseAttachmentSpec(line: string): ThreadProtocolAttachment | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length === 0) {
    return null
  }

  const first = parts[0]?.toLowerCase() ?? ''
  if (ATTACHMENT_KINDS.has(first)) {
    const location = trimmed.slice(parts[0].length).trim().replace(/^['"]|['"]$/g, '')
    if (!location) {
      return null
    }
    return { kind: normalizeAttachmentKind(first, location), location }
  }

  return { kind: normalizeAttachmentKind('', trimmed), location: trimmed }
}

function normalizeAttachmentKind(kind: string, location: string) {
  if (kind === 'media') {
    return inferAttachmentKind(location)
  }
  if (kind) {
    return kind
  }
  return inferAttachmentKind(location)
}

function inferAttachmentKind(location: string) {
  const lower = location.trim().toLowerCase()
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp')
  ) {
    return 'image'
  }
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.mkv') ||
    lower.endsWith('.avi')
  ) {
    return 'video'
  }
  if (
    lower.endsWith('.mp3') ||
    lower.endsWith('.wav') ||
    lower.endsWith('.m4a') ||
    lower.endsWith('.aac') ||
    lower.endsWith('.ogg')
  ) {
    return 'voice'
  }
  return 'file'
}

function buildAttachmentSummaryMarkdown(attachments: ThreadProtocolAttachment[]) {
  if (!attachments.length) {
    return ''
  }

  return attachments
    .map((attachment) => `- ${attachment.kind}: ${attachmentDisplayName(attachment.location)}`)
    .join('\n')
}

function attachmentDisplayName(location: string) {
  const trimmed = location.trim()
  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\/+$/, '')
    const fileName = pathname.split('/').pop()?.trim()
    if (fileName) {
      return decodeURIComponent(fileName)
    }
    return trimmed
  }

  const normalized = trimmed.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop()?.trim()
  return fileName || trimmed
}
