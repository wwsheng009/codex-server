import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type RailIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean
}

export type ResizeHandleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  axis: 'horizontal' | 'vertical'
  edge?: 'start' | 'end'
}

export type RailIconProps = {
  children: ReactNode
}
