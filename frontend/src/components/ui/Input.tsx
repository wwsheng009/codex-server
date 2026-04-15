import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { i18n } from '../../i18n/runtime'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  icon?: ReactNode
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, icon, fullWidth = true, className = '', ...props }, ref) => {
    const id = useId()
    const inputId = props.id || id
    const isNumber = props.type === 'number'

    const handleIncrement = () => {
      const input = document.getElementById(inputId) as HTMLInputElement
      if (input) {
        input.stepUp()
        input.dispatchEvent(new Event('change', { bubbles: true }))
        // Also trigger input event for React state updates if used with value/onChange
        const event = new Event('input', { bubbles: true })
        input.dispatchEvent(event)
      }
    }

    const handleDecrement = () => {
      const input = document.getElementById(inputId) as HTMLInputElement
      if (input) {
        input.stepDown()
        input.dispatchEvent(new Event('change', { bubbles: true }))
        const event = new Event('input', { bubbles: true })
        input.dispatchEvent(event)
      }
    }

    return (
      <div className={['field', fullWidth ? 'field--full' : '', className].filter(Boolean).join(' ')}>
        {label && (
          <label className="field-label" htmlFor={inputId}>
            {label}
          </label>
        )}
        <div className={['field-control', isNumber ? 'field-control--number' : ''].join(' ')}>
          {isNumber && !props.disabled && (
            <button
              type="button"
              className="field-stepper field-stepper--left"
              onClick={handleDecrement}
              tabIndex={-1}
              aria-label={i18n._({ id: 'Decrease value', message: 'Decrease value' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          )}
          {icon && <span className="field-icon">{icon}</span>}
          <input
            {...props}
            className={['field-input', error ? 'field-input--error' : ''].filter(Boolean).join(' ')}
            id={inputId}
            ref={ref}
          />
          {isNumber && !props.disabled && (
            <button
              type="button"
              className="field-stepper field-stepper--right"
              onClick={handleIncrement}
              tabIndex={-1}
              aria-label={i18n._({ id: 'Increase value', message: 'Increase value' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          )}
        </div>
        {error && <small className="field-error">{error}</small>}
        {hint && !error && <small className="field-hint">{hint}</small>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
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
