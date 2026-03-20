import { AnsiUp } from 'ansi_up'
import { useMemo } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
}: {
  content: string
  className?: string
}) {
  if (!content.trim()) {
    return null
  }

  return (
    <div className={joinClassNames('thread-markdown', className)}>
      <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {content}
      </Markdown>
    </div>
  )
}

export function ThreadCodeBlock({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  if (!content) {
    return null
  }

  return (
    <pre className={joinClassNames('thread-code-block', className)}>
      <code>{content}</code>
    </pre>
  )
}

export function ThreadTerminalBlock({
  content,
  className,
}: {
  content: string
  className?: string
}) {
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

function joinClassNames(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(' ')
}
