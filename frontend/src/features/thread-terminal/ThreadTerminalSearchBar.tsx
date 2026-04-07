import type { FormEvent } from 'react'

import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalSearchBarState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalSearchBar({
  feedback,
  query,
  onChangeQuery,
  onClose,
  onSearchNext,
  onSearchPrevious,
}: ThreadTerminalSearchBarState) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearchNext()
  }

  return (
    <form className="terminal-dock__search" onSubmit={handleSubmit}>
      <input
        aria-label={i18n._({
          id: 'Search terminal output field',
          message: 'Search terminal output field',
        })}
        onChange={(event) => onChangeQuery(event.target.value)}
        placeholder={i18n._({
          id: 'Search terminal output',
          message: 'Search terminal output',
        })}
        value={query}
      />
      <div className="terminal-dock__search-actions">
        <button
          aria-label={i18n._({
            id: 'Previous match',
            message: 'Previous match',
          })}
          className="terminal-dock__search-button terminal-dock__search-button--icon"
          title={i18n._({
            id: 'Previous match',
            message: 'Previous match',
          })}
          type="button"
          onClick={onSearchPrevious}
        >
          <SearchPreviousIcon />
        </button>
        <button
          aria-label={i18n._({
            id: 'Next match',
            message: 'Next match',
          })}
          className="terminal-dock__search-button terminal-dock__search-button--icon"
          title={i18n._({
            id: 'Next match',
            message: 'Next match',
          })}
          type="submit"
        >
          <SearchNextIcon />
        </button>
        <button
          aria-label={i18n._({
            id: 'Close terminal search',
            message: 'Close terminal search',
          })}
          className="terminal-dock__search-button terminal-dock__search-button--icon"
          title={i18n._({
            id: 'Close terminal search',
            message: 'Close terminal search',
          })}
          type="button"
          onClick={onClose}
        >
          <SearchCloseIcon />
        </button>
      </div>
      {feedback === 'not-found' ? (
        <span className="terminal-dock__search-feedback">
          {i18n._({
            id: 'No match',
            message: 'No match',
          })}
        </span>
      ) : null}
    </form>
  )
}

function SearchPreviousIcon() {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
      <path
        d="m7 14 5-5 5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function SearchNextIcon() {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
      <path
        d="m7 10 5 5 5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function SearchCloseIcon() {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
      <path
        d="m8 8 8 8M16 8l-8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  )
}
