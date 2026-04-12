export const DEFAULT_SESSION_START_TEMPLATE = `在处理当前请求前，请先遵循以下项目上下文与约定。
{{source_path_line}}项目上下文摘录：
{{context}}

用户请求：
{{user_request}}`

export const SESSION_START_TEMPLATE_PREVIEW_SOURCE_PATH = "README.md"
export const SESSION_START_TEMPLATE_PREVIEW_CONTEXT = `# Project Context

- run tests before finalizing
- keep hooks visible in the thread`
export const SESSION_START_TEMPLATE_PREVIEW_USER_REQUEST =
  "请修复 hooks 的入口治理"

export function normalizeSessionStartTemplate(value?: string | null) {
  const trimmed = (value ?? "").trim()
  return trimmed ? trimmed : null
}

export function renderSessionStartTemplatePreview(
  value?: string | null,
  input: {
    sourcePath?: string | null
    context?: string | null
    userRequest?: string | null
  } = {},
) {
  const template = normalizeSessionStartTemplate(value) ?? DEFAULT_SESSION_START_TEMPLATE
  const sourcePath = (input.sourcePath ?? SESSION_START_TEMPLATE_PREVIEW_SOURCE_PATH).trim()
  const context = (input.context ?? SESSION_START_TEMPLATE_PREVIEW_CONTEXT).trim()
  const userRequest = (input.userRequest ?? SESSION_START_TEMPLATE_PREVIEW_USER_REQUEST).trim()
  const sourcePathLine = sourcePath ? `来源文件：${sourcePath}\n` : ""

  return template
    .replaceAll("{{source_path_line}}", sourcePathLine)
    .replaceAll("{{source_path}}", sourcePath)
    .replaceAll("{{context}}", context)
    .replaceAll("{{user_request}}", userRequest)
    .trim()
}
