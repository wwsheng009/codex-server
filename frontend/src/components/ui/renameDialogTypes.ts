export type RenameDialogProps = {
  title: string
  description: string
  value: string
  fieldLabel?: string
  placeholder?: string
  submitLabel?: string
  isSubmitDisabled?: boolean
  error?: string | null
  isPending?: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}
