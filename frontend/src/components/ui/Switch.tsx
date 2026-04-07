import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
  hint?: ReactNode
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ label, hint, className = '', ...props }, ref) => {
    const id = useId()
    const switchId = props.id || id

    return (
      <div className={['ide-switch-group', className].filter(Boolean).join(' ')}>
        <label className="ide-switch" htmlFor={switchId}>
          <input
            {...props}
            id={switchId}
            ref={ref}
            type="checkbox"
          />
          <span className="ide-switch-slider" />
        </label>
        {(label || hint) && (
          <div className="ide-switch-copy">
            {label && <label htmlFor={switchId}>{label}</label>}
            {hint && <small>{hint}</small>}
          </div>
        )}
      </div>
    )
  }
)

Switch.displayName = 'Switch'
