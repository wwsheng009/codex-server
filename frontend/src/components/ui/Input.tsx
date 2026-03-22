import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  icon?: ReactNode
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, icon, fullWidth = true, className = '', ...props }, ref) => {
    const id = useId()
    const inputId = props.id || id

    return (
      <div className={['field', fullWidth ? 'field--full' : '', className].filter(Boolean).join(' ')}>
        {label && (
          <label className="field-label" htmlFor={inputId}>
            {label}
          </label>
        )}
        <div className="field-control">
          {icon && <span className="field-icon">{icon}</span>}
          <input
            {...props}
            className={['field-input', error ? 'field-input--error' : ''].filter(Boolean).join(' ')}
            id={inputId}
            ref={ref}
          />
        </div>
        {error && <small className="field-error">{error}</small>}
        {hint && !error && <small className="field-hint">{hint}</small>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  fullWidth?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, fullWidth = true, className = '', children, ...props }, ref) => {
    const id = useId()
    const selectId = props.id || id

    return (
      <div className={['field', fullWidth ? 'field--full' : '', className].filter(Boolean).join(' ')}>
        {label && (
          <label className="field-label" htmlFor={selectId}>
            {label}
          </label>
        )}
        <select
          {...props}
          className={['field-input', error ? 'field-input--error' : ''].filter(Boolean).join(' ')}
          id={selectId}
          ref={ref}
        >
          {children}
        </select>
        {error && <small className="field-error">{error}</small>}
        {hint && !error && <small className="field-hint">{hint}</small>}
      </div>
    )
  }
)

Select.displayName = 'Select'
