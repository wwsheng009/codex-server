import type { QueryClient } from '@tanstack/react-query'

import type { Account, RateLimit, ServerEvent } from '../../types/api'
import { accountQueryKey, rateLimitsQueryKey } from './api'

type RateLimitSnapshotLike = {
  limitId?: string | null
  limitName?: string | null
  primary?: {
    usedPercent?: number | null
    windowDurationMins?: number | null
    resetsAt?: string | number | null
  } | null
  secondary?: {
    usedPercent?: number | null
    windowDurationMins?: number | null
    resetsAt?: string | number | null
  } | null
  credits?: {
    hasCredits?: boolean | null
    unlimited?: boolean | null
    balance?: string | number | null
  } | null
  planType?: string | null
}

type AccountUpdatedPayloadLike = {
  authMode?: string | null
  planType?: string | null
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberField(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return null
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function normalizeResetAt(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized === '') {
      return null
    }

    const timestamp = Date.parse(normalized)
    return Number.isNaN(timestamp) ? normalized : new Date(timestamp).toISOString()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1_000).toISOString()
  }

  return null
}

function parseRateLimitWindow(value: unknown): RateLimit['primary'] {
  const record = asObject(value)
  if (!record) {
    return null
  }

  const usedPercent = numberField(record.usedPercent)
  const windowDurationMins = numberField(record.windowDurationMins)
  const resetsAt = normalizeResetAt(record.resetsAt)
  if (usedPercent === null) {
    return null
  }

  return {
    usedPercent,
    windowDurationMins,
    resetsAt,
  }
}

function parseRateLimitCredits(value: unknown): RateLimit['credits'] {
  const record = asObject(value)
  if (!record) {
    return null
  }

  const hasCredits = booleanField(record.hasCredits)
  const unlimited = booleanField(record.unlimited)
  const rawBalance = record.balance
  const balance =
    typeof rawBalance === 'number' && Number.isFinite(rawBalance)
      ? String(rawBalance)
      : stringField(rawBalance) || null

  if (hasCredits === null && unlimited === null && !balance) {
    return null
  }

  return {
    hasCredits: hasCredits ?? false,
    unlimited: unlimited ?? false,
    balance,
  }
}

export function parseRateLimitSnapshot(value: unknown): RateLimit | null {
  const record = asObject(value)
  if (!record) {
    return null
  }

  const limitId = stringField(record.limitId) || null
  const limitName = stringField(record.limitName) || null
  const primary = parseRateLimitWindow(record.primary)
  const secondary = parseRateLimitWindow(record.secondary)
  const credits = parseRateLimitCredits(record.credits)
  const planType = stringField(record.planType) || null

  if (!limitId && !limitName && !primary && !secondary && !credits && !planType) {
    return null
  }

  return {
    limitId,
    limitName,
    primary,
    secondary,
    credits,
    planType,
  }
}

export function parseRateLimitUpdatedEventPayload(payload: unknown): RateLimit | null {
  const record = asObject(payload)
  if (!record) {
    return parseRateLimitSnapshot(payload)
  }

  return parseRateLimitSnapshot(record.rateLimits ?? payload)
}

function rateLimitIdentity(limit: RateLimit) {
  const limitId = typeof limit.limitId === 'string' ? limit.limitId.trim() : ''
  if (limitId) {
    return limitId
  }

  const limitName = typeof limit.limitName === 'string' ? limit.limitName.trim() : ''
  if (limitName) {
    return limitName
  }

  return 'codex'
}

export function mergeRateLimitSnapshot(
  current: RateLimit[] | undefined,
  incoming: RateLimit,
): RateLimit[] {
  const items = Array.isArray(current) ? [...current] : []
  const incomingIdentity = rateLimitIdentity(incoming)
  const existingIndex = items.findIndex((item) => rateLimitIdentity(item) === incomingIdentity)

  if (existingIndex === -1) {
    return [incoming, ...items]
  }

  const existing = items[existingIndex]
  items[existingIndex] = {
    ...existing,
    ...incoming,
    primary: incoming.primary ?? existing.primary ?? null,
    secondary: incoming.secondary ?? existing.secondary ?? null,
    credits: incoming.credits ?? existing.credits ?? null,
    planType: incoming.planType ?? existing.planType ?? null,
    limitId: incoming.limitId ?? existing.limitId ?? null,
    limitName: incoming.limitName ?? existing.limitName ?? null,
  }
  return items
}

export function applyRateLimitUpdatedEventToCache(
  queryClient: Pick<QueryClient, 'setQueryData'>,
  workspaceId: string,
  event: Pick<ServerEvent, 'method' | 'payload'>,
) {
  if (event.method !== 'account/rateLimits/updated') {
    return false
  }

  const snapshot = parseRateLimitUpdatedEventPayload(event.payload)
  if (!snapshot) {
    return false
  }

  queryClient.setQueryData<RateLimit[] | undefined>(
    rateLimitsQueryKey(workspaceId),
    (current) => mergeRateLimitSnapshot(current, snapshot),
  )
  return true
}

export function parseAccountUpdatedEventPayload(payload: unknown): AccountUpdatedPayloadLike | null {
  const record = asObject(payload)
  if (!record) {
    return null
  }

  const authMode = stringField(record.authMode) || null
  const planType = stringField(record.planType) || null
  if (!authMode && !planType) {
    return null
  }

  return {
    authMode,
    planType,
  }
}

function deriveAccountStatus(authMode: string | null) {
  return authMode ? 'connected' : 'disconnected'
}

function deriveAccountEmail(current: Account | undefined, authMode: string | null) {
  const existingEmail = typeof current?.email === 'string' ? current.email.trim() : ''
  if (!authMode) {
    return 'not-connected'
  }

  if (existingEmail && existingEmail !== 'not-connected') {
    return existingEmail
  }

  return authMode
}

export function mergeAccountUpdatedEvent(
  current: Account | undefined,
  payload: AccountUpdatedPayloadLike,
): Account {
  const authMode = payload.authMode ?? null
  const planType = payload.planType ?? null

  return {
    id: current?.id ?? 'acct_runtime',
    email: deriveAccountEmail(current, authMode),
    status: deriveAccountStatus(authMode),
    authMode,
    planType,
    lastSyncedAt: new Date().toISOString(),
  }
}

export function applyAccountUpdatedEventToCache(
  queryClient: Pick<QueryClient, 'setQueryData'>,
  workspaceId: string,
  event: Pick<ServerEvent, 'method' | 'payload'>,
) {
  if (event.method !== 'account/updated') {
    return false
  }

  const payload = parseAccountUpdatedEventPayload(event.payload)
  if (!payload) {
    return false
  }

  queryClient.setQueryData<Account | undefined>(
    accountQueryKey(workspaceId),
    (current) => mergeAccountUpdatedEvent(current, payload),
  )
  return true
}

export async function syncAccountQueriesFromEvent(
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'setQueryData'>,
  workspaceId: string,
  event: Pick<ServerEvent, 'method' | 'payload'>,
) {
  const invalidations: Promise<unknown>[] = []
  let handled = false

  if (event.method === 'account/updated') {
    handled = true
    applyAccountUpdatedEventToCache(queryClient, workspaceId, event)
    invalidations.push(queryClient.invalidateQueries({ queryKey: accountQueryKey(workspaceId) }))
  }

  if (event.method === 'account/rateLimits/updated') {
    handled = true
    applyRateLimitUpdatedEventToCache(queryClient, workspaceId, event)
    invalidations.push(queryClient.invalidateQueries({ queryKey: rateLimitsQueryKey(workspaceId) }))
  }

  if (invalidations.length > 0) {
    await Promise.all(invalidations)
  }

  return handled
}

export type { RateLimitSnapshotLike }
