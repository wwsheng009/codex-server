export type CreateWorkspaceDialogProps = {
  name: string
  rootPath: string
  isPending?: boolean
  error?: string | null
  onNameChange: (value: string) => void
  onRootPathChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}
