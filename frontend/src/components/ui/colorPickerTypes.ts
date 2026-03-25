export type ColorPickerProps = {
  value: string
  onChange: (hex: string) => void
  label?: string
  presets?: string[]
}
