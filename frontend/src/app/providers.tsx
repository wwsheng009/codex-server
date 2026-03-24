import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { AppearanceController } from './AppearanceController'
import { WorkspaceApprovalsQuerySync } from '../features/approvals/WorkspaceApprovalsQuerySync'
import { LinguiClientProvider } from '../i18n/LinguiClientProvider'
import { ToastHost } from '../components/ui/ToastHost'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

type ProvidersProps = {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <LinguiClientProvider>
        <AppearanceController />
        <WorkspaceApprovalsQuerySync />
        <ToastHost />
        {children}
      </LinguiClientProvider>
    </QueryClientProvider>
  )
}
