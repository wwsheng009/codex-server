import { describe, expect, it } from 'vitest'

import {
  getSelectedThreadIdForWorkspace,
  resolveMissingWorkspaceReferences,
} from './session-store-utils'

describe('getSelectedThreadIdForWorkspace', () => {
  it('prefers the workspace-specific selection map', () => {
    expect(
      getSelectedThreadIdForWorkspace(
        {
          selectedThreadId: 'thread-fallback',
          selectedThreadIdByWorkspace: {
            'ws-1': 'thread-specific',
          },
          selectedWorkspaceId: 'ws-1',
        },
        'ws-1',
      ),
    ).toBe('thread-specific')
  })
})

describe('resolveMissingWorkspaceReferences', () => {
  it('keeps valid selected and route workspace references', () => {
    expect(
      resolveMissingWorkspaceReferences({
        pathname: '/workspaces/ws-1/threads/thread-1',
        selectedWorkspaceId: 'ws-1',
        workspaceIds: ['ws-1', 'ws-2'],
      }),
    ).toEqual({
      missingRouteWorkspaceId: undefined,
      missingSelectedWorkspaceId: undefined,
      shouldRedirectToWorkspaceList: false,
    })
  })

  it('detects a stale persisted selected workspace id', () => {
    expect(
      resolveMissingWorkspaceReferences({
        pathname: '/workspaces',
        selectedWorkspaceId: 'ws-missing',
        workspaceIds: ['ws-1', 'ws-2'],
      }),
    ).toEqual({
      missingRouteWorkspaceId: undefined,
      missingSelectedWorkspaceId: 'ws-missing',
      shouldRedirectToWorkspaceList: false,
    })
  })

  it('detects a stale workspace id in the current thread route', () => {
    expect(
      resolveMissingWorkspaceReferences({
        pathname: '/workspaces/ws-missing/threads/thread-1',
        selectedWorkspaceId: 'ws-1',
        workspaceIds: ['ws-1', 'ws-2'],
      }),
    ).toEqual({
      missingRouteWorkspaceId: 'ws-missing',
      missingSelectedWorkspaceId: undefined,
      shouldRedirectToWorkspaceList: true,
    })
  })
})
