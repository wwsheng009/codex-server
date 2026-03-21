# UI 内容模型 (UI Content Model)

本页定义核心页面实际展示的**对象模型**和**字段优先级**。目标是避免设计稿只画容器，不定义内容，最后实现时才发现字段不够或优先级混乱。

当前字段来源主要来自:

- `frontend/src/types/api.ts`
- `frontend/src/features/settings/sections.ts`
- `frontend/src/pages/*.tsx`

## 1. 使用规则

每个对象用 3 层字段优先级描述:

- **P0 核心字段**: 用户在当前页面做决定必须看到
- **P1 支撑字段**: 支撑理解或筛选，通常默认可见
- **P2 次级字段**: 可折叠、次要、hover、详情、弹层或二级面板显示

## 2. Workspace

### 2.1 数据字段

来自 `Workspace`:

- `id`
- `name`
- `rootPath`
- `runtimeStatus`
- `createdAt`
- `updatedAt`

### 2.2 页面映射

#### Workspaces Page

- **P0**: `name`, `rootPath`, `runtimeStatus`
- **P1**: `updatedAt`, `id` short form
- **P2**: `createdAt`

#### Sidebar / Workspace Scope

- **P0**: `name`
- **P1**: `runtimeStatus`
- **P2**: `rootPath`

## 3. Thread

### 3.1 数据字段

来自 `Thread` / `ThreadDetail`:

- `id`
- `workspaceId`
- `name`
- `status`
- `archived`
- `createdAt`
- `updatedAt`
- `cwd`
- `preview`
- `path`
- `source`
- `tokenUsage`
- `turns`

### 3.2 页面映射

#### Sidebar Thread Row

- **P0**: `name`, `status`
- **P1**: `updatedAt`, `archived`
- **P2**: `id`, `preview`

#### Thread Workspace Header

- **P0**: `name`
- **P1**: `workspaceId`, `status`
- **P2**: `cwd`, `path`, `source`

#### Thread Timeline

- **P0**: `turns.items`
- **P1**: `turns.status`, `turns.error`
- **P2**: `tokenUsage`

## 4. Thread Turn / Timeline Item

### 4.1 当前内容类型

依据系统设计与现有渲染:

- `agentMessage`
- `reasoning`
- `plan`
- `commandExecution`
- `fileChange`
- `dynamicToolCall`
- `mcpToolCall`
- approval-related items

### 4.2 展示优先级

#### agentMessage

- **P0**: message content
- **P1**: inline code, file paths, bullets
- **P2**: provenance, timestamps, raw metadata

#### reasoning / plan

- **P0**: summary
- **P1**: steps / plan items
- **P2**: raw details / intermediate metadata

#### commandExecution

- **P0**: command, status
- **P1**: output preview, process state
- **P2**: full logs, command metadata

#### fileChange

- **P0**: file path, change kind
- **P1**: diff summary
- **P2**: full diff details

## 5. Pending Approval

### 5.1 数据字段

来自 `PendingApproval` / `ApprovalDetails`:

- `id`
- `workspaceId`
- `threadId`
- `kind`
- `summary`
- `status`
- `actions`
- `details`
- `requestedAt`

`details` 可能包含:

- `itemId`
- `threadId`
- `turnId`
- `callId`
- `tool`
- `arguments`
- `message`
- `mode`
- `url`
- `questions`
- `requestedSchema`

### 5.2 页面映射

#### Timeline Approval Card

- **P0**: `summary`, `actions`, `status`
- **P1**: `kind`, `requestedAt`, important `details`
- **P2**: raw arguments / schema

#### Global Approval Drawer

- **P0**: `summary`, `status`, `actions`
- **P1**: `threadId`, `workspaceId`, question set
- **P2**: low-level payload details

## 6. Automation

### 6.1 数据字段

来自 `Automation`:

- `id`
- `title`
- `description`
- `prompt`
- `workspaceId`
- `workspaceName`
- `threadId`
- `schedule`
- `scheduleLabel`
- `model`
- `reasoning`
- `status`
- `nextRun`
- `nextRunAt`
- `lastRun`
- `createdAt`
- `updatedAt`

### 6.2 页面映射

#### Automations Directory

- **P0**: `title`, `description`
- **P1**: template category or object grouping
- **P2**: created/updated time

#### Automations Current List

- **P0**: `title`, `workspaceName`, `scheduleLabel`, `status`
- **P1**: `nextRun`, `lastRun`
- **P2**: `model`, `reasoning`

#### Automation Detail

- **P0**: `title`, `description`, `status`, `scheduleLabel`, `workspaceName`
- **P1**: `model`, `reasoning`, `nextRun`, `lastRun`
- **P2**: `prompt`, `createdAt`, `updatedAt`, linked `threadId`

## 7. Automation Template

### 7.1 数据字段

来自 `AutomationTemplate`:

- `id`
- `category`
- `title`
- `description`
- `prompt`
- `isBuiltIn`
- `createdAt`
- `updatedAt`

### 7.2 页面映射

#### Template Card

- **P0**: `title`, `description`
- **P1**: `category`, `isBuiltIn`
- **P2**: `prompt`, timestamps

#### Create Modal Prefill

- **P0**: `title`, `description`, `prompt`
- **P1**: `category`

## 8. Automation Run

### 8.1 数据字段

来自 `AutomationRun`:

- `id`
- `automationId`
- `automationTitle`
- `workspaceId`
- `workspaceName`
- `threadId`
- `turnId`
- `trigger`
- `status`
- `summary`
- `error`
- `startedAt`
- `finishedAt`
- `logs`

### 8.2 页面映射

#### Recent Runs List

- **P0**: `status`, `startedAt`, `trigger`
- **P1**: `summary`, `error`
- **P2**: `finishedAt`, `threadId`, `turnId`

#### Run Detail / Modal

- **P0**: `status`, `summary`, `logs`
- **P1**: `error`, `startedAt`, `finishedAt`
- **P2**: ids and join keys

## 9. Skill / Remote Skill

### 9.1 数据字段

当前页面使用的目录字段:

- `id`
- `name`
- `description`

### 9.2 页面映射

#### Skill Directory Item

- **P0**: `name`
- **P1**: `description`
- **P2**: `id`, source label, install status metadata

## 10. Runtime Catalog Item

### 10.1 数据字段

来自 `CatalogItem`:

- `id`
- `name`
- `description`
- `value`
- `shellType`

### 10.2 页面映射

#### Runtime Inventory Row/Card

- **P0**: `name`
- **P1**: `description`, `shellType`
- **P2**: `id`, `value`

## 11. Notification Item

### 11.1 数据字段

来自 `NotificationItem`:

- `id`
- `workspaceId`
- `workspaceName`
- `automationId`
- `automationTitle`
- `runId`
- `kind`
- `title`
- `message`
- `level`
- `read`
- `createdAt`
- `readAt`

### 11.2 页面映射

#### Notification Center

- **P0**: `title`, `message`, `level`
- **P1**: `workspaceName`, `createdAt`, `read`
- **P2**: linked automation/run ids

## 12. Settings Section

### 12.1 数据字段

来自 `settingsSections`:

- `id`
- `to`
- `label`
- `caption`

### 12.2 页面映射

#### Settings Sidebar

- **P0**: `label`
- **P1**: current section state
- **P2**: `caption`

## 13. 文案与标签优先级

设计稿需要对内容长度做假设:

- **Name / Title**: 可短可中，必须允许溢出处理
- **Description**: 1-3 行默认展示，长文本应截断或折叠
- **Path / rootPath / cwd**: 默认允许复制或在窄屏截断
- **Status**: 优先使用 pill / badge
- **Timestamp**: 首选相对时间，详情中提供绝对时间

## 14. 内容模型交付规则

任何页面设计交付，必须显式回答:

- 当前页面主对象是谁
- P0 / P1 / P2 字段分别是什么
- 哪些字段可被折叠
- 哪些字段只能出现在 hover / context menu / drawer
- 字段过长时如何处理

## 15. 关联文档

- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- [UI 编写指导](./UI_WRITING.md)

---
*没有内容模型的页面设计，通常会在实现阶段退化成“先占坑再补字段”。*
