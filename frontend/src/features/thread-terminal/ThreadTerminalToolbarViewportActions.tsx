import { i18n } from '../../i18n/runtime'
import {
  ClearToolIcon,
  CopyToolIcon,
  FitToolIcon,
  FocusToolIcon,
  PasteToolIcon,
  SearchToolIcon,
  TerminalToolButton,
} from './threadTerminalToolbarControls'
import type {
  ThreadTerminalToolbarViewportActionsState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalToolbarViewportActions({
  canCopy,
  canPaste,
  searchDisabled,
  onClearViewport,
  onCopySelection,
  onFitViewport,
  onFocusViewport,
  onPasteClipboard,
  onSearchTerminal,
}: ThreadTerminalToolbarViewportActionsState) {
  const fitTitle = i18n._({
    id: 'Fit terminal',
    message: 'Fit terminal',
  })
  const focusTitle = i18n._({
    id: 'Focus terminal',
    message: 'Focus terminal',
  })
  const copyTitle = i18n._({
    id: 'Copy selection',
    message: 'Copy selection',
  })
  const pasteTitle = i18n._({
    id: 'Paste clipboard',
    message: 'Paste clipboard',
  })
  const searchTitle = i18n._({
    id: 'Search terminal',
    message: 'Search terminal',
  })
  const clearTitle = i18n._({
    id: 'Clear viewport',
    message: 'Clear viewport',
  })

  return (
    <>
      <TerminalToolButton aria-label={fitTitle} onClick={onFitViewport} title={fitTitle}>
        <FitToolIcon />
      </TerminalToolButton>
      <TerminalToolButton aria-label={focusTitle} onClick={onFocusViewport} title={focusTitle}>
        <FocusToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={copyTitle}
        disabled={!canCopy}
        onClick={onCopySelection}
        title={copyTitle}
      >
        <CopyToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={pasteTitle}
        disabled={!canPaste}
        onClick={onPasteClipboard}
        title={pasteTitle}
      >
        <PasteToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={searchTitle}
        disabled={searchDisabled}
        onClick={onSearchTerminal}
        title={searchTitle}
      >
        <SearchToolIcon />
      </TerminalToolButton>
      <TerminalToolButton aria-label={clearTitle} onClick={onClearViewport} title={clearTitle}>
        <ClearToolIcon />
      </TerminalToolButton>
    </>
  )
}
