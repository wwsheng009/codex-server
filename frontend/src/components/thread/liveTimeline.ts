import type { ServerEvent } from '../../types/api'
import { decodeBase64, stringField } from './threadRender'

export type LiveTimelineEntry =
  | {
      kind: 'event'
      key: string
      event: ServerEvent
    }
  | {
      kind: 'delta'
      key: string
      groupKey: string
      title: string
      subtitle?: string
      text: string
      startedTs: string
      endedTs: string
      count: number
    }

export function buildLiveTimelineEntries(events: ServerEvent[]) {
  const entries: LiveTimelineEntry[] = []

  for (const event of events) {
    const aggregate = toDeltaAggregate(event)
    if (!aggregate) {
      entries.push({
        kind: 'event',
        key: `${event.ts}-${event.method}-${entries.length}`,
        event,
      })
      continue
    }

    const previous = entries[entries.length - 1]
    if (previous?.kind === 'delta' && previous.groupKey === aggregate.groupKey) {
      previous.text += aggregate.text
      previous.endedTs = event.ts
      previous.count += 1
      continue
    }

    entries.push({
      kind: 'delta',
      key: `${event.ts}-${aggregate.groupKey}-${entries.length}`,
      groupKey: aggregate.groupKey,
      title: aggregate.title,
      subtitle: aggregate.subtitle,
      text: aggregate.text,
      startedTs: event.ts,
      endedTs: event.ts,
      count: 1,
    })
  }

  return entries
}

function toDeltaAggregate(event: ServerEvent) {
  const payload = asObject(event.payload)

  switch (event.method) {
    case 'item/agentMessage/delta': {
      const itemId = stringField(payload.itemId)
      return {
        groupKey: `agent:${itemId || 'unknown'}`,
        title: 'Agent Message Streaming',
        subtitle: itemId || undefined,
        text: stringField(payload.delta),
      }
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const itemId = stringField(payload.itemId)
      return {
        groupKey: `reasoning:${itemId || event.method}`,
        title:
          event.method === 'item/reasoning/summaryTextDelta'
            ? 'Reasoning Summary Streaming'
            : 'Reasoning Streaming',
        subtitle: itemId || undefined,
        text: stringField(payload.delta),
      }
    }
    case 'command/exec/outputDelta': {
      const processId = stringField(payload.processId)
      const stream = stringField(payload.stream) || 'output'
      return {
        groupKey: `command:${processId}:${stream}`,
        title: `Command ${stream} Streaming`,
        subtitle: processId || undefined,
        text: decodeBase64(stringField(payload.deltaBase64)),
      }
    }
    default:
      return null
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}
