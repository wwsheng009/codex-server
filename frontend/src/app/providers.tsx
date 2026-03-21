import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { AppearanceController } from './AppearanceController'
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
      <AppearanceController />
      <ToastHost />
      {children}
    </QueryClientProvider>
  )
}
