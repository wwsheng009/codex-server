import { useMemo } from 'react'

import type { UseThreadPageSelectedThreadInput } from './threadPageRuntimeTypes'

export function useThreadPageSelectedThread({
  selectedThreadId,
  threadDetail,
  threads,
}: UseThreadPageSelectedThreadInput) {
  return useMemo(
    () =>
      (threadDetail?.id === selectedThreadId ? threadDetail : undefined) ??
      threads?.find((thread) => thread.id === selectedThreadId) ??
      (!selectedThreadId ? threads?.[0] : undefined) ??
      threadDetail,
    [selectedThreadId, threadDetail, threads],
  )
}
