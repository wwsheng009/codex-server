import { apiRequest } from '../../lib/api-client'
import type {
  Account,
  AccountCancelLoginResult,
  AccountLoginResult,
  RateLimit,
} from '../../types/api'

export type LoginAccountInput = { type: 'apiKey'; apiKey: string } | { type: 'chatgpt' }

export type CancelLoginAccountInput = {
  loginId: string
}

export function accountQueryKey(workspaceId: string) {
  return ['account', workspaceId] as const
}

export function rateLimitsQueryKey(workspaceId: string) {
  return ['rate-limits', workspaceId] as const
}

function buildWorkspaceAccountPath(workspaceId: string, suffix = '') {
  return `/api/workspaces/${workspaceId}/account${suffix}`
}

export function getAccount(workspaceId: string) {
  return apiRequest<Account>(buildWorkspaceAccountPath(workspaceId))
}

export function getRateLimits(workspaceId: string) {
  return apiRequest<RateLimit[]>(buildWorkspaceAccountPath(workspaceId, '/rate-limits'))
}

export function loginAccount(
  workspaceId: string,
  input: LoginAccountInput,
) {
  return apiRequest<AccountLoginResult>(buildWorkspaceAccountPath(workspaceId, '/login'), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function logoutAccount(workspaceId: string) {
  return apiRequest<{ status: string }>(buildWorkspaceAccountPath(workspaceId, '/logout'), {
    method: 'POST',
  })
}

export function cancelLoginAccount(workspaceId: string, input: CancelLoginAccountInput) {
  return apiRequest<AccountCancelLoginResult>(buildWorkspaceAccountPath(workspaceId, '/login/cancel'), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
