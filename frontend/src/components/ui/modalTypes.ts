import type { ReactNode } from 'react'

export type ModalProps = {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  maxWidth?: string
  className?: string
}
