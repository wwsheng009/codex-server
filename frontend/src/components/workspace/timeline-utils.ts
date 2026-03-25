import { decodeBase64 } from '../thread/threadRender'
import { formatRelativeTimeShort } from '../../i18n/format'
import type { ServerEvent } from '../../types/api'

export { formatRelativeTimeShort }
import type { LiveTimelineEntry } from './timelineUtilsTypes'
export type { LiveTimelineEntry } from './timelineUtilsTypes'

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
    case 'item/agentMessage/delta':
      return {
        groupKey: `agent:${stringField(payload.itemId) || 'unknown'}`,
        title: 'Agent Message Stream',
        subtitle: stringField(payload.itemId) || undefined,
        text: stringField(payload.delta),
      }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return {
        groupKey: `reasoning:${stringField(payload.itemId) || event.method}`,
        title: 'Reasoning Stream',
        subtitle: stringField(payload.itemId) || undefined,
        text: stringField(payload.delta),
      }
    case 'command/exec/outputDelta':
      return {
        groupKey: `command:${stringField(payload.processId)}:${stringField(payload.stream)}`,
        title: 'Command Output',
        subtitle: stringField(payload.processId) || undefined,
        text:
          stringField(payload.deltaText) ||
          decodeBase64(stringField(payload.deltaBase64)),
      }
    default:
      return null
  }
}

function asObject(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}
