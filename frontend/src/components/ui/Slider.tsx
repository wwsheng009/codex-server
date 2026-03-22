import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes } from 'react'

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  hint?: string
  showValue?: boolean
  unit?: string
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ label, hint, showValue = true, unit = '', className = '', value, ...props }, ref) => {
    const id = useId()
    const sliderId = props.id || id

    return (
      <div className={['field ide-slider-field', className].filter(Boolean).join(' ')}>
        {label && (
          <label className="field-label" htmlFor={sliderId}>
            {label}
          </label>
        )}
        <div className="ide-slider-control">
          <input
            {...props}
            className="ide-slider"
            id={sliderId}
            ref={ref}
            type="range"
            value={value}
          />
          {showValue && (
            <span className="ide-slider-value" aria-hidden="true">
              {value}{unit}
            </span>
          )}
        </div>
        {hint && <small className="field-hint">{hint}</small>}
      </div>
    )
  }
)

Slider.displayName = 'Slider'
