import { RouterProvider } from 'react-router-dom'

import { Providers } from './providers'
import { router } from './router'
import { AccessGate } from '../features/access/AccessGate'

export default function App() {
  return (
    <Providers>
      <AccessGate>
        <RouterProvider router={router} />
      </AccessGate>
    </Providers>
  )
}
