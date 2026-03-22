import { useEffect, useState } from 'react'

function readDocumentVisibility() {
  if (typeof document === 'undefined') {
    return true
  }

  return document.visibilityState !== 'hidden'
}

export function useDocumentVisibility() {
  const [isDocumentVisible, setIsDocumentVisible] = useState(readDocumentVisibility)

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    function handleVisibilityChange() {
      setIsDocumentVisible(readDocumentVisibility())
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return isDocumentVisible
}
