export type ConfirmDialogProps = {
  title: string
  description: string
  subject?: string
  confirmLabel: string
  cancelLabel?: string
  error?: string | null
  isPending?: boolean
  onClose: () => void
  onConfirm: () => void
}
