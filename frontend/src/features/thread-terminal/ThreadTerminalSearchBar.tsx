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
        onChange={(event) => onChangeQuery(event.target.value)}
        placeholder={i18n._({
          id: 'Search terminal output',
          message: 'Search terminal output',
        })}
        value={query}
      />
      <button className="terminal-dock__search-button" type="submit">
        {i18n._({
          id: 'Next',
          message: 'Next',
        })}
      </button>
      <button
        className="terminal-dock__search-button"
        onClick={onSearchPrevious}
        type="button"
      >
        {i18n._({
          id: 'Prev',
          message: 'Prev',
        })}
      </button>
      <button className="terminal-dock__search-button" onClick={onClose} type="button">
        {i18n._({
          id: 'Close',
          message: 'Close',
        })}
      </button>
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
