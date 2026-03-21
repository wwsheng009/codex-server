import { useMemo } from 'react'

import type { Thread, ThreadDetail } from '../../types/api'

export function useThreadPageSelectedThread({
  selectedThreadId,
  threadDetail,
  threads,
}: {
  selectedThreadId?: string
  threadDetail?: ThreadDetail
  threads?: Thread[]
}) {
  return useMemo(
    () =>
      threads?.find((thread) => thread.id === selectedThreadId) ??
      (threadDetail?.id === selectedThreadId ? threadDetail : undefined),
    [selectedThreadId, threadDetail, threads],
  )
}
