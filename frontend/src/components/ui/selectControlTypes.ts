export type SelectOption = {
  value: string
  label: string
  triggerLabel?: string
  disabled?: boolean
}

export type SelectControlProps = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  menuLabel?: string
  className?: string
  menuClassName?: string
  optionClassName?: string
  disabled?: boolean
  fullWidth?: boolean
}

export type SelectMenuPosition = {
  top: number
  left: number
  minWidth: number
  maxWidth: number
  transformOrigin: string
}
