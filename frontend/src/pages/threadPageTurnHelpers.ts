import { isApiClientErrorCode } from '../lib/api-client'
import type { Thread, ThreadTurn } from '../types/api'

export type PendingThreadTurn = {
  localId: string
  threadId: string
  input: string
  submittedAt: string
  phase: 'sending' | 'waiting'
  turnId?: string
}

export function updateThreadStatusInList(
  current: Thread[] | undefined,
  threadId: string,
  status: string,
  updatedAt = new Date().toISOString(),
) {
  if (!current?.length) {
    return current
  }

  return current.map((item) =>
    item.id === threadId
      ? {
          ...item,
          status,
          updatedAt,
        }
      : item,
  )
}

export function buildRetryPromptFromServerRequest(item: Record<string, unknown>) {
  const requestKind = typeof item.requestKind === 'string' ? item.requestKind : ''
  const details =
    typeof item.details === 'object' && item.details !== null
      ? (item.details as Record<string, unknown>)
      : {}

  switch (requestKind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval': {
      const command = typeof details.command === 'string' ? details.command : ''
      return command
        ? `Please retry the command request for \`${command}\` so I can review it again.`
        : 'Please retry the previous command request so I can review it again.'
    }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval': {
      const path = typeof details.path === 'string' ? details.path : ''
      if (path) {
        return `Please regenerate the proposed changes for \`${path}\` so I can review them again.`
      }

      const changes = Array.isArray(details.changes) ? details.changes.length : 0
      return changes
        ? `Please regenerate the previous ${changes} file change${changes === 1 ? '' : 's'} so I can review them again.`
        : 'Please regenerate the previous file changes so I can review them again.'
    }
    case 'item/tool/requestUserInput':
      return 'Please ask for the required user input again so I can answer it.'
    case 'item/permissions/requestApproval': {
      const reason = typeof details.reason === 'string' ? details.reason : ''
      return reason
        ? `Please retry the action that requested additional permissions. Reason: ${reason}`
        : 'Please retry the action that requested additional permissions and explain why they are needed.'
    }
    case 'mcpServer/elicitation/request': {
      const serverName = typeof details.serverName === 'string' ? details.serverName : ''
      return serverName
        ? `Please retry the MCP request for ${serverName} and ask me for the required input again.`
        : 'Please retry the MCP request and ask me for the required input again.'
    }
    case 'item/tool/call': {
      const tool = typeof details.tool === 'string' ? details.tool : ''
      return tool
        ? `Please retry the tool call \`${tool}\` and ask me for the required response again.`
        : 'Please retry the previous tool call and ask me for the required response again.'
    }
    case 'account/chatgptAuthTokens/refresh':
      return 'Please retry the authentication refresh flow and ask me for anything required.'
    default:
      return 'Please retry the previous request so I can complete it again.'
  }
}

export function createPendingTurn(threadId: string, input: string): PendingThreadTurn {
  const localId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `pending-${Date.now()}`

  return {
    localId,
    threadId,
    input,
    submittedAt: new Date().toISOString(),
    phase: 'sending',
  }
}

export function buildPendingThreadTurn(pendingTurn: PendingThreadTurn): ThreadTurn {
  return {
    id: pendingTurn.turnId ?? `pending-${pendingTurn.localId}`,
    status: pendingTurn.phase === 'sending' ? 'sending' : 'inProgress',
    items: [
      {
        content: [
          {
            text: pendingTurn.input,
            type: 'inputText',
          },
        ],
        id: `pending-user-${pendingTurn.localId}`,
        type: 'userMessage',
      },
    ],
  }
}

export function shouldRetryTurnAfterResume(error: unknown) {
  if (isApiClientErrorCode(error, 'thread_not_found')) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('thread not found') || message.includes('thread not loaded')
}
