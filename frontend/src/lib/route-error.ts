import { isRouteErrorResponse } from 'react-router-dom'

export type RouteErrorDescription = {
  code: string
  title: string
  message: string
  recovery: string
  details: string
}

const DYNAMIC_IMPORT_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module/i

export function describeRouteError(error: unknown): RouteErrorDescription {
  if (isRouteErrorResponse(error)) {
    const responseMessage = readRouteErrorPayload(error.data)
    const statusLabel = [String(error.status), error.statusText].filter(Boolean).join(' ')

    if (error.status === 404) {
      return {
        code: `HTTP ${error.status}`,
        title: 'This screen could not be found',
        message: responseMessage || 'The route or backing resource is no longer available.',
        recovery: 'Move back to a stable area of the app or retry after checking the URL and resource state.',
        details: buildDetails([
          `Status: ${statusLabel}`,
          responseMessage ? `Response: ${responseMessage}` : '',
        ]),
      }
    }

    if (error.status === 401 || error.status === 403) {
      return {
        code: `HTTP ${error.status}`,
        title: 'Access to this screen was denied',
        message: responseMessage || 'Your current session cannot open this route.',
        recovery: 'Re-authenticate if needed, then retry the route or move to a screen your session can access.',
        details: buildDetails([
          `Status: ${statusLabel}`,
          responseMessage ? `Response: ${responseMessage}` : '',
        ]),
      }
    }

    if (error.status >= 500) {
      return {
        code: `HTTP ${error.status}`,
        title: 'The app hit an internal route error',
        message: responseMessage || 'The server returned an error before this screen finished loading.',
        recovery: 'Retry this route first. If it keeps failing, back out to a stable screen and inspect the details below.',
        details: buildDetails([
          `Status: ${statusLabel}`,
          responseMessage ? `Response: ${responseMessage}` : '',
        ]),
      }
    }

    return {
      code: `HTTP ${error.status}`,
      title: error.statusText || 'This route returned an unexpected response',
      message: responseMessage || 'The route returned an unexpected response and could not complete rendering.',
      recovery: 'Retry the route or navigate back to a stable screen.',
      details: buildDetails([
        `Status: ${statusLabel}`,
        responseMessage ? `Response: ${responseMessage}` : '',
      ]),
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim()
    const isDynamicImportError = DYNAMIC_IMPORT_ERROR_PATTERN.test(`${error.name} ${message}`)

    return {
      code: error.name || 'Runtime Error',
      title: isDynamicImportError ? 'Part of the app failed to load' : 'This screen crashed while rendering',
      message: message || 'A runtime exception interrupted this route before it finished rendering.',
      recovery: isDynamicImportError
        ? 'Reload this route to request the missing bundle again. If a deployment just changed, a refresh usually resolves it.'
        : 'Retry this route first. If it fails again, move back to a stable screen and use the technical details to debug it.',
      details: buildDetails([
        error.name ? `Name: ${error.name}` : '',
        message ? `Message: ${message}` : '',
        error.stack ? `Stack:\n${error.stack}` : '',
      ]),
    }
  }

  const rawValue = readRouteErrorPayload(error)
  if (rawValue) {
    return {
      code: 'Unknown Error',
      title: 'Something went wrong on this route',
      message: rawValue,
      recovery: 'Retry the route or move back to a stable screen.',
      details: `Value: ${rawValue}`,
    }
  }

  return {
    code: 'Unknown Error',
    title: 'Something went wrong on this route',
    message: 'An unknown route error interrupted rendering.',
    recovery: 'Retry the route or move back to a stable screen.',
    details: '',
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
