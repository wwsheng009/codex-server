// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import type { FormEvent } from 'react'
import { render, screen } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchRailThreadToolsSection } from './ThreadWorkbenchRailThreadToolsSection'

function buildBaseProps() {
  return {
    deletePending: false,
    deletingThreadId: undefined,
    editingThreadId: undefined,
    editingThreadName: '',
    isThreadToolsExpanded: true,
    onArchiveToggle: () => undefined,
    onBeginRenameThread: () => undefined,
    onCancelRenameThread: () => undefined,
    onChangeEditingThreadName: () => undefined,
    onDeleteThread: () => undefined,
    onSubmitRenameThread: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    },
    onToggleThreadToolsExpanded: () => undefined,
    selectedThread: {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Release Thread',
      status: 'idle',
      archived: false,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    },
  }
}

describe('ThreadWorkbenchRailThreadToolsSection', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('renders thread management actions for the selected thread', () => {
    render(<ThreadWorkbenchRailThreadToolsSection {...buildBaseProps()} />)

    expect(screen.getByText('Thread tools')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })
})
