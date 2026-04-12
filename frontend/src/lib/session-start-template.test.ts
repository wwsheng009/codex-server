import { describe, expect, it } from "vitest"

import {
  DEFAULT_SESSION_START_TEMPLATE,
  normalizeSessionStartTemplate,
  renderSessionStartTemplatePreview,
} from "./session-start-template"

describe("session-start-template", () => {
  it("normalizes empty values to null", () => {
    expect(normalizeSessionStartTemplate("")).toBeNull()
    expect(normalizeSessionStartTemplate("   ")).toBeNull()
    expect(normalizeSessionStartTemplate("  abc  ")).toBe("abc")
  })

  it("renders the built-in default preview when the field is blank", () => {
    expect(renderSessionStartTemplatePreview("")).toContain("在处理当前请求前")
    expect(renderSessionStartTemplatePreview("")).toContain("来源文件：README.md")
  })

  it("expands all supported placeholders", () => {
    const output = renderSessionStartTemplatePreview(
      "S={{source_path}}\nL={{source_path_line}}C={{context}}\nR={{user_request}}",
      {
        sourcePath: "docs/session-start.md",
        context: "ctx",
        userRequest: "req",
      },
    )

    expect(output).toBe(
      "S=docs/session-start.md\nL=来源文件：docs/session-start.md\nC=ctx\nR=req",
    )
  })

  it("keeps the default template stable", () => {
    expect(DEFAULT_SESSION_START_TEMPLATE).toContain("{{context}}")
    expect(DEFAULT_SESSION_START_TEMPLATE).toContain("{{user_request}}")
  })
})
