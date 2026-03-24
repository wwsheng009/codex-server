import { lazy, Suspense } from 'react'

import { i18n } from '../../i18n/runtime'
import { ThreadTerminalBlock } from '../../components/thread/ThreadContent'
import { ThreadTerminalViewport } from './ThreadTerminalViewport'
import {
  canCommandSessionInteract,
  isWindowsCommandSession,
} from './threadTerminalSessionBehavior'
import type {
  ThreadTerminalViewportStackState
} from './threadTerminalConsoleStateTypes'

const ThreadTerminalLauncherViewport = lazy(async () =>
  import('./ThreadTerminalViewport').then((module) => ({
    default: module.ThreadTerminalLauncherViewport,
  })),
)

export function ThreadTerminalViewportStack({
  activeRenderableSession,
  commandSessionsCount,
  defaultShellLauncherName,
  isLauncherOpen,
  launcherHistory,
  launcherMode,
  launcherRef,
  onCloseLauncher,
  onLauncherSelectionChange,
  onResizeTerminal,
  onSessionSelectionChange,
  onStartLauncherCommand,
  onStartShellFromLauncher,
  onWriteTerminalData,
  rootPath,
  shouldUsePlainTextViewport,
  startCommandPending,
  viewportRefs,
  viewportStackRef,
}: ThreadTerminalViewportStackState) {
  return (
    <div className="terminal-dock__viewport-stack" ref={viewportStackRef}>
      <Suspense
        fallback={
          <div className="terminal-dock__output terminal-dock__output--loading">
            {i18n._({
              id: 'Loading terminal…',
              message: 'Loading terminal…',
            })}
          </div>
        }
      >
        <ThreadTerminalLauncherViewport
          className={
            isLauncherOpen
              ? 'terminal-dock__output terminal-dock__output--active terminal-dock__output--launcher'
              : 'terminal-dock__output terminal-dock__output--hidden terminal-dock__output--launcher'
          }
          history={launcherHistory}
          mode={launcherMode}
          onClose={commandSessionsCount ? onCloseLauncher : undefined}
          onSelectionChange={onLauncherSelectionChange}
          onRunCommand={onStartLauncherCommand}
          onStartShell={onStartShellFromLauncher}
          pending={startCommandPending}
          ref={launcherRef}
          shellLabel={defaultShellLauncherName}
          visible={isLauncherOpen}
        />
        {activeRenderableSession ? (
          shouldUsePlainTextViewport ? (
            <div className="terminal-dock__output terminal-dock__output--active terminal-dock__output--static">
              <ThreadTerminalBlock
                className="terminal-dock__static-output"
                content={activeRenderableSession.combinedOutput ?? ''}
              />
            </div>
          ) : (
            <ThreadTerminalViewport
              className="terminal-dock__output terminal-dock__output--active"
              content={activeRenderableSession.combinedOutput ?? ''}
              interactive={canCommandSessionInteract(activeRenderableSession)}
              key={activeRenderableSession.id}
              onResize={onResizeTerminal}
              onSelectionChange={(hasSelection) =>
                onSessionSelectionChange(activeRenderableSession.id, hasSelection)
              }
              onWriteData={onWriteTerminalData}
              ref={(instance) => {
                if (instance) {
                  viewportRefs.current[activeRenderableSession.id] = instance
                  return
                }

                delete viewportRefs.current[activeRenderableSession.id]
              }}
              sessionId={activeRenderableSession.id}
              visible
              windowsPty={isWindowsCommandSession({
                rootPath,
                session: activeRenderableSession,
              })}
            />
          )
        ) : null}
      </Suspense>
    </div>
  )
}
