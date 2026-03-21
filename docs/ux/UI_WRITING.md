# UI 编写指导 (UI Writing & Voice)

## 1. 核心设计语音 (Voice DNA)
Codex 的语音应像是一个**冷静、高效、专业的 Peer Programmer**。
- **专业 (Authority)**: 不使用模糊的词汇（如 "Something", "Maybe"）。
- **简洁 (Minimalist)**: 每一个字都必须有意义。
- **协作 (Collaborative)**: 在错误或引导时提供具体的建议，而非责备。

## 2. 语气原则 (Tone Principles)
- **正面积极**: 使用 "Success" 而非 "Not Failed"。
- **现在时态**: 描述当前状态（如 "Running" 而非 "Was Running"）。
- **主动语态**: 描述用户动作（如 "Delete workspace" 而非 "The workspace will be deleted"）。

## 3. 核心词汇表 (Standard Glossary)
为了保证术语的一致性，严禁混用以下词汇。
| Term | Meaning | Forbidden Synonyms |
| :--- | :--- | :--- |
| `Workspace` | 运行时上下文的根目录 | Root, Project, Folder |
| `Thread` | 与 AI 协作的具体会话 | Chat, Session, Topic |
| `Automation` | 预定义的自动化任务 | Bot, Script, Tool |
| `Runtime` | 后端执行环境的状态 | Engine, System, Server |

## 4. 文本样式规范 (Style Guide)

### 大小写 (Capitalization)
- **Sentence case**: 仅首字母大写。用于标题、标签、说明文案。
  - 正确: "Register a new root"
  - 错误: "Register A New Root"
- **Upper case**: 仅用于极小的元数据标签（Meta Labels）。
  - 示例: `ID`, `UPDATED`

### 标点符号 (Punctuation)
- **句号**: 仅用于多行描述性文案（Description）。按钮、输入框 Label 严禁使用句号。
- **感叹号**: 全局禁止使用。

## 5. 反馈文案模式 (Feedback Patterns)

### 错误消息 (Error Messages)
- **模式**: [发生的事实] + [具体原因] + [解决建议]。
- **示例**: "Automation Failed: Invalid YAML syntax in line 42. Check your configuration."

### 空状态 (Empty States)
- **模式**: [当前无内容] + [这对用户的意义] + [引导动作]。
- **示例**: "No automations found. Create your first automation to optimize your workflow. [Create Automation]"

## 6. 无障碍文案 (A11y Writing)
- **图标描述**: 所有 IconButton 必须包含语义化的 `aria-label`（如 "Close Modal" 而非 "Cross Icon"）。
- **可读性**: 句子长度建议控制在 15 个单词以内。
