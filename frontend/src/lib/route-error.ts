import { isRouteErrorResponse } from 'react-router-dom'
import { i18n } from '../i18n/runtime'
import type { RouteErrorDescription } from './route-error-types'
export type { RouteErrorDescription } from './route-error-types'

const DYNAMIC_IMPORT_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module/i

export function describeRouteError(error: unknown): RouteErrorDescription {
  if (isRouteErrorResponse(error)) {
    const responseMessage = readRouteErrorPayload(error.data)
    const statusLabel = [String(error.status), error.statusText].filter(Boolean).join(' ')
    const responseDetails = buildRouteResponseDetails(
      error.status,
      error.statusText,
      error.data,
      'internal' in error ? (error as Record<string, unknown>).internal : undefined,
    )

    if (error.status === 404) {
      return {
        code: `HTTP ${error.status}`,
        title: i18n._({
          id: 'This screen could not be found',
          message: 'This screen could not be found',
        }),
        message:
          responseMessage ||
          i18n._({
            id: 'The route or backing resource is no longer available.',
            message: 'The route or backing resource is no longer available.',
          }),
        recovery: i18n._({
          id: 'Move back to a stable area of the app or retry after checking the URL and resource state.',
          message:
            'Move back to a stable area of the app or retry after checking the URL and resource state.',
        }),
        details:
          responseDetails ||
          i18n._({
            id: 'Status: {status}',
            message: 'Status: {status}',
            values: { status: statusLabel },
          }),
      }
    }

    if (error.status === 401 || error.status === 403) {
      return {
        code: `HTTP ${error.status}`,
        title: i18n._({
          id: 'Access to this screen was denied',
          message: 'Access to this screen was denied',
        }),
        message:
          responseMessage ||
          i18n._({
            id: 'Your current session cannot open this route.',
            message: 'Your current session cannot open this route.',
          }),
        recovery: i18n._({
          id: 'Re-authenticate if needed, then retry the route or move to a screen your session can access.',
          message:
            'Re-authenticate if needed, then retry the route or move to a screen your session can access.',
        }),
        details:
          responseDetails ||
          i18n._({
            id: 'Status: {status}',
            message: 'Status: {status}',
            values: { status: statusLabel },
          }),
      }
    }

    if (error.status >= 500) {
      return {
        code: `HTTP ${error.status}`,
        title: i18n._({
          id: 'The app hit an internal route error',
          message: 'The app hit an internal route error',
        }),
        message:
          responseMessage ||
          i18n._({
            id: 'The server returned an error before this screen finished loading.',
            message: 'The server returned an error before this screen finished loading.',
          }),
        recovery: i18n._({
          id: 'Retry this route first. If it keeps failing, back out to a stable screen and inspect the details below.',
          message:
            'Retry this route first. If it keeps failing, back out to a stable screen and inspect the details below.',
        }),
        details:
          responseDetails ||
          i18n._({
            id: 'Status: {status}',
            message: 'Status: {status}',
            values: { status: statusLabel },
          }),
      }
    }

    return {
      code: `HTTP ${error.status}`,
      title:
        error.statusText ||
        i18n._({
          id: 'This route returned an unexpected response',
          message: 'This route returned an unexpected response',
        }),
      message:
        responseMessage ||
        i18n._({
          id: 'The route returned an unexpected response and could not complete rendering.',
          message: 'The route returned an unexpected response and could not complete rendering.',
        }),
      recovery: i18n._({
        id: 'Retry the route or navigate back to a stable screen.',
        message: 'Retry the route or navigate back to a stable screen.',
      }),
      details:
        responseDetails ||
        i18n._({
          id: 'Status: {status}',
          message: 'Status: {status}',
          values: { status: statusLabel },
        }),
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim()
    const isDynamicImportError = DYNAMIC_IMPORT_ERROR_PATTERN.test(`${error.name} ${message}`)

    return {
      code: error.name || i18n._({ id: 'Runtime Error', message: 'Runtime Error' }),
      title: isDynamicImportError
        ? i18n._({
            id: 'Part of the app failed to load',
            message: 'Part of the app failed to load',
          })
        : i18n._({
            id: 'This screen crashed while rendering',
            message: 'This screen crashed while rendering',
          }),
      message:
        message ||
        i18n._({
          id: 'A runtime exception interrupted this route before it finished rendering.',
          message: 'A runtime exception interrupted this route before it finished rendering.',
        }),
      recovery: isDynamicImportError
        ? i18n._({
            id: 'Reload this route to request the missing bundle again. If a deployment just changed, a refresh usually resolves it.',
            message:
              'Reload this route to request the missing bundle again. If a deployment just changed, a refresh usually resolves it.',
          })
        : i18n._({
            id: 'Retry this route first. If it fails again, move back to a stable screen and use the technical details to debug it.',
            message:
              'Retry this route first. If it fails again, move back to a stable screen and use the technical details to debug it.',
          }),
      details: buildRuntimeErrorDetails(error),
    }
  }

  const rawValue = readRouteErrorPayload(error)
  const formattedValue = formatDiagnosticValue(error)
  if (rawValue) {
    return {
      code: i18n._({ id: 'Unknown Error', message: 'Unknown Error' }),
      title: i18n._({
        id: 'Something went wrong on this route',
        message: 'Something went wrong on this route',
      }),
      message: rawValue,
      recovery: i18n._({
        id: 'Retry the route or move back to a stable screen.',
        message: 'Retry the route or move back to a stable screen.',
      }),
      details: buildNamedDetails(i18n._({ id: 'Value', message: 'Value' }), formattedValue || rawValue),
    }
  }

  return {
    code: i18n._({ id: 'Unknown Error', message: 'Unknown Error' }),
    title: i18n._({
      id: 'Something went wrong on this route',
      message: 'Something went wrong on this route',
    }),
    message: i18n._({
      id: 'An unknown route error interrupted rendering.',
      message: 'An unknown route error interrupted rendering.',
    }),
    recovery: i18n._({
      id: 'Retry the route or move back to a stable screen.',
      message: 'Retry the route or move back to a stable screen.',
    }),
    details: buildNamedDetails(i18n._({ id: 'Value', message: 'Value' }), formattedValue),
  }
}

function readRouteErrorPayload(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (value instanceof Error) {
    return value.message.trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  const candidateKeys = ['message', 'error', 'detail', 'title']
  for (const key of candidateKeys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function buildDetails(lines: string[]) {
  return lines.filter(Boolean).join('\n')
}

function buildRouteResponseDetails(
  status: number,
  statusText: string,
  data: unknown,
  internal: unknown,
) {
  return buildDetails([
    i18n._({
      id: 'Status: {status}',
      message: 'Status: {status}',
      values: { status: [String(status), statusText].filter(Boolean).join(' ') },
    }),
    buildNamedDetails(
      i18n._({ id: 'Response payload', message: 'Response payload' }),
      formatDiagnosticValue(data),
    ),
    internal === undefined
      ? ''
      : i18n._({
          id: 'Internal: {value}',
          message: 'Internal: {value}',
          values: { value: String(internal) },
        }),
  ])
}

function buildRuntimeErrorDetails(error: Error, seen = new WeakSet<object>()) {
  if (seen.has(error)) {
    return '[Circular Error]'
  }

  seen.add(error)

  const message = error.message.trim()
  const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined
  const aggregateErrors = 'errors' in error ? (error as Error & { errors?: unknown }).errors : undefined
  const metadata = extractErrorMetadata(error, seen)

  return buildDetails([
    error.name
      ? i18n._({
          id: 'Name: {name}',
          message: 'Name: {name}',
          values: { name: error.name },
        })
      : '',
    message
      ? i18n._({
          id: 'Message: {message}',
          message: 'Message: {message}',
          values: { message },
        })
      : '',
    cause === undefined
      ? ''
      : buildNamedDetails(i18n._({ id: 'Cause', message: 'Cause' }), formatDiagnosticValue(cause, seen)),
    Array.isArray(aggregateErrors) && aggregateErrors.length > 0
      ? buildNamedDetails(i18n._({ id: 'Errors', message: 'Errors' }), formatDiagnosticValue(aggregateErrors, seen))
      : '',
    metadata ? buildNamedDetails(i18n._({ id: 'Metadata', message: 'Metadata' }), metadata) : '',
    error.stack
      ? i18n._({
          id: 'Stack:\n{stack}',
          message: 'Stack:\n{stack}',
          values: { stack: error.stack },
        })
      : '',
  ])
}

function extractErrorMetadata(error: Error, seen: WeakSet<object>) {
  const metadataKeys = Object.getOwnPropertyNames(error).filter(
    (key) => !['name', 'message', 'stack', 'cause', 'errors'].includes(key),
  )

  if (metadataKeys.length === 0) {
    return ''
  }

  const metadata: Record<string, unknown> = {}
  for (const key of metadataKeys) {
    try {
      metadata[key] = (error as unknown as Record<string, unknown>)[key]
    } catch (readError) {
      metadata[key] =
        readError instanceof Error
          ? readError.message
          : i18n._({ id: 'Unable to read value', message: 'Unable to read value' })
    }
  }

  return formatDiagnosticValue(metadata, seen)
}

function buildNamedDetails(label: string, value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed.includes('\n') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return `${label}:\n${trimmed}`
  }

  return `${label}: ${trimmed}`
}

function formatDiagnosticValue(value: unknown, seen = new WeakSet<object>()): string {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (value instanceof Error) {
    return buildRuntimeErrorDetails(value, seen)
  }

  const normalized = normalizeDiagnosticValue(value, seen)
  if (normalized === undefined) {
    return ''
  }

  if (typeof normalized === 'string') {
    return normalized
  }

  try {
    return JSON.stringify(normalized, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeDiagnosticValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'bigint') {
    return `${value}n`
  }

  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (typeof value === 'function') {
    return i18n._({
      id: '[Function {name}]',
      message: '[Function {name}]',
      values: {
        name: value.name || i18n._({ id: 'anonymous', message: 'anonymous' }),
      },
    })
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof URL) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDiagnosticValue(item, seen))
  }

  if (!value || typeof value !== 'object') {
    return String(value)
  }

  if (seen.has(value)) {
    return '[Circular]'
  }

  seen.add(value)

  const entries: [string, unknown][] = []
  for (const key of Object.getOwnPropertyNames(value)) {
    try {
      entries.push([key, normalizeDiagnosticValue((value as Record<string, unknown>)[key], seen)])
    } catch (readError) {
      entries.push([
        key,
        readError instanceof Error ? `[Unreadable: ${readError.message}]` : '[Unreadable value]',
      ])
    }
  }

  if (entries.length === 0) {
    return String(value)
  }

  return Object.fromEntries(entries)
}
