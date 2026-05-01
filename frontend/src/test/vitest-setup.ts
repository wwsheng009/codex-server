import { expect } from 'vitest'

function toBeInTheDocument(received: unknown) {
  const pass = typeof Node !== 'undefined' && received instanceof Node && received.ownerDocument?.contains(received) === true

  return {
    pass,
    message: () =>
      pass
        ? 'expected element not to be present in the document'
        : 'expected element to be present in the document',
  }
}

expect.extend({
  toBeInTheDocument,
})

declare module 'vitest' {
  interface Matchers<T = any> {
    toBeInTheDocument(): T
  }

  interface Assertion<T = any> {
    toBeInTheDocument(): T
  }

  interface AsymmetricMatchersContaining {
    toBeInTheDocument(): void
  }
}
