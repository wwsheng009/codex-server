import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonIntent = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: ButtonIntent
  size?: ButtonSize
  isLoading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, intent = 'primary', size = 'md', isLoading, icon, className = '', disabled, ...props }, ref) => {
    const intentClass = `ide-button--${intent}`
    const sizeClass = `ide-button--${size}`
    const classes = [
      'ide-button',
      intentClass,
      sizeClass,
      isLoading ? 'ide-button--loading' : '',
      className
    ].filter(Boolean).join(' ')

    return (
      <button
        className={classes}
        disabled={disabled || isLoading}
        ref={ref}
        type={props.type || 'button'}
        {...props}
      >
        {isLoading && <span className="ide-button__spinner" />}
        {icon && <span className="ide-button__icon">{icon}</span>}
        <span className="ide-button__text">{children}</span>
      </button>
    )
  }
)

Button.displayName = 'Button'
