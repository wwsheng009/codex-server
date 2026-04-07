import { forwardRef, useId } from 'react'
import type { ReactNode, TextareaHTMLAttributes } from 'react'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  fullWidth?: boolean
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, hint, error, fullWidth = true, className = '', ...props }, ref) => {
    const id = useId()
    const textAreaId = props.id || id

    return (
      <div className={['field', fullWidth ? 'field--full' : '', className].filter(Boolean).join(' ')}>
        {label && (
          <label className="field-label" htmlFor={textAreaId}>
            {label}
          </label>
        )}
        <textarea
          {...props}
          className={['field-input ide-textarea', error ? 'field-input--error' : ''].filter(Boolean).join(' ')}
          id={textAreaId}
          ref={ref}
        />
        {error && <small className="field-error">{error}</small>}
        {hint && !error && <small className="field-hint">{hint}</small>}
      </div>
    )
  }
)

TextArea.displayName = 'TextArea'
