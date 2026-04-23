// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LinguiClientProvider } from '../../i18n/LinguiClientProvider'
import { useSettingsLocalStore } from '../settings/local-store'
import { AccessGate } from './AccessGate'

const settingsApiState = vi.hoisted(() => ({
  loginAccess: vi.fn(),
  readAccessBootstrap: vi.fn(),
}))

vi.mock('../settings/api', async () => {
  const actual = await vi.importActual('../settings/api')
  return {
    ...actual,
    loginAccess: settingsApiState.loginAccess,
    readAccessBootstrap: settingsApiState.readAccessBootstrap,
  }
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
}

function renderAccessGate() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <LinguiClientProvider>
        <AccessGate>
          <div>workspace</div>
        </AccessGate>
      </LinguiClientProvider>
    </QueryClientProvider>,
  )
}

describe('AccessGate', () => {
  beforeEach(() => {
    settingsApiState.loginAccess.mockReset()
    settingsApiState.readAccessBootstrap.mockReset()
    settingsApiState.readAccessBootstrap.mockResolvedValue({
      activeTokenCount: 1,
      allowLocalhostWithoutAccessToken: false,
      allowRemoteAccess: true,
      authenticated: false,
      loginRequired: true,
    })
    window.localStorage.clear()
    useSettingsLocalStore.setState({ locale: 'en' })
  })

  afterEach(() => {
    cleanup()
  })

  it('switches the login screen copy when the locale selector changes', async () => {
    renderAccessGate()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in with access token' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Interface language' }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: '简体中文 · Chinese (Simplified)' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('option', { name: '简体中文 · Chinese (Simplified)' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '使用访问令牌登录' })).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: '界面语言' }).textContent).toContain('中文')
    expect(useSettingsLocalStore.getState().locale).toBe('zh-CN')
  })
})
