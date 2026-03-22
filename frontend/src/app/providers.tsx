import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { AppearanceController } from './AppearanceController'
import { LinguiClientProvider } from '../i18n/LinguiClientProvider'
import { ToastHost } from '../components/ui/ToastHost'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LinguiClientProvider>
        <AppearanceController />
        <ToastHost />
        {children}
      </LinguiClientProvider>
    </QueryClientProvider>
  )
}
