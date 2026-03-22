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
      (threadDetail?.id === selectedThreadId ? threadDetail : undefined) ??
      threads?.find((thread) => thread.id === selectedThreadId) ??
      (!selectedThreadId ? threads?.[0] : undefined) ??
      threadDetail,
    [selectedThreadId, threadDetail, threads],
  )
}
