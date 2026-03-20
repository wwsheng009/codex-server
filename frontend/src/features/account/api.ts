import { apiRequest } from '../../lib/api-client'
import type {
  Account,
  AccountCancelLoginResult,
  AccountLoginResult,
  RateLimit,
} from '../../types/api'

export function getAccount() {
  return apiRequest<Account>('/api/account')
}

export function getRateLimits() {
  return apiRequest<RateLimit[]>('/api/account/rate-limits')
}

export function loginAccount(input: { type: 'apiKey'; apiKey: string } | { type: 'chatgpt' }) {
  return apiRequest<AccountLoginResult>('/api/account/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function logoutAccount() {
  return apiRequest<{ status: string }>('/api/account/logout', {
    method: 'POST',
  })
}

export function cancelLoginAccount(input: { loginId: string }) {
  return apiRequest<AccountCancelLoginResult>('/api/account/login/cancel', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
