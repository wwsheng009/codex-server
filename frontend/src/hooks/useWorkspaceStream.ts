import { useEffect } from 'react'

import { API_BASE_URL } from '../lib/api-client'
import { useSessionStore } from '../stores/session-store'
import type { ServerEvent } from '../types/api'

export function useWorkspaceStream(workspaceId?: string) {
  const setConnectionState = useSessionStore((state) => state.setConnectionState)

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    const wsBase = API_BASE_URL.replace(/^http/, 'ws')
    const ws = new WebSocket(`${wsBase}/api/workspaces/${workspaceId}/stream`)

    setConnectionState(workspaceId, 'connecting')

    ws.onopen = () => {
      setConnectionState(workspaceId, 'open')
    }

    ws.onmessage = (message) => {
      const event = JSON.parse(message.data) as ServerEvent
      useSessionStore.getState().ingestEvent(event)
    }

    ws.onclose = () => {
      setConnectionState(workspaceId, 'closed')
    }

    ws.onerror = () => {
      setConnectionState(workspaceId, 'error')
    }

    return () => {
      ws.close()
    }
  }, [setConnectionState, workspaceId])

  return useSessionStore((state) =>
    workspaceId ? state.connectionByWorkspace[workspaceId] ?? 'idle' : 'idle',
  )
}
