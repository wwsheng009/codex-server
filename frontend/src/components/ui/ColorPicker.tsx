import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react'
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, isValidHex } from '../../lib/color'
import type { HSV } from '../../lib/colorTypes'
import type { ColorPickerProps } from './colorPickerTypes'

export function ColorPicker({
  value,
  onChange,
  label,
  presets = ['#0969DA', '#268BD2', '#2AA198', '#859900', '#B58900', '#CB4B16', '#DC322F', '#D33682', '#6C71C4', '#002B36', '#FDF6E3', '#FFFFFF'],
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hsv, setHsv] = useState<HSV>(rgbToHsv(hexToRgb(value)))
  const [tempHex, setTempHex] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const satRef = useRef<HTMLDivElement>(null)
  
  // Sync internal state when prop value changes
  useEffect(() => {
    if (isValidHex(value)) {
      setTempHex(value)
      const newHsv = rgbToHsv(hexToRgb(value))
      setHsv(newHsv)
    }
  }, [value])

  const handleOpen = () => setIsOpen(!isOpen)

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, handleClickOutside])

  const updateColor = (newHsv: HSV) => {
    setHsv(newHsv)
    const rgb = hsvToRgb(newHsv)
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b)
    setTempHex(hex)
    onChange(hex)
  }

  const handleSaturationChange = (e: ReactMouseEvent | ReactTouchEvent) => {
    if (!satRef.current) return
    const rect = satRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    
    let s = ((clientX - rect.left) / rect.width) * 100
    let v = 100 - ((clientY - rect.top) / rect.height) * 100
    
    s = Math.max(0, Math.min(100, s))
    v = Math.max(0, Math.min(100, v))
    
    updateColor({ ...hsv, s, v })
  }

  const handleHueChange = (e: ChangeEvent<HTMLInputElement>) => {
    const h = parseInt(e.target.value)
    updateColor({ ...hsv, h })
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value
    setTempHex(hex)
    if (isValidHex(hex)) {
      onChange(hex)
    }
  }

  const handlePresetClick = (hex: string) => {
    onChange(hex)
  }

  // Calculate pointer position
  const pointerLeft = `${hsv.s}%`
  const pointerTop = `${100 - hsv.v}%`
  const hueBackground = `hsl(${hsv.h}, 100%, 50%)`

  return (
    <div className="color-picker-container" ref={containerRef}>
      {label && <label className="field-label">{label}</label>}
      <div className="color-picker-trigger" onClick={handleOpen}>
        <div className="color-picker-swatch" style={{ backgroundColor: value }} />
        <span className="color-picker-value">{value}</span>
      </div>

      {isOpen && (
        <div className="color-picker-dropdown">
          <div 
            className="color-picker-saturation" 
            ref={satRef}
            style={{ backgroundColor: hueBackground }}
            onMouseDown={handleSaturationChange}
            onTouchStart={handleSaturationChange}
          >
            <div className="saturation-white">
              <div className="saturation-black">
                <div 
                  className="saturation-pointer" 
                  style={{ left: pointerLeft, top: pointerTop }}
                />
              </div>
            </div>
          </div>

          <div className="color-picker-controls">
            <div className="color-picker-hue-wrapper">
              <input 
                type="range" 
                min="0" 
                max="360" 
                value={hsv.h} 
                onChange={handleHueChange}
                className="color-picker-hue-slider"
              />
            </div>
            
            <div className="color-picker-inputs">
              <input 
                type="text" 
                value={tempHex} 
                onChange={handleInputChange}
                className="color-picker-input"
                spellCheck={false}
              />
              <div className="color-picker-preview" style={{ backgroundColor: value }} />
            </div>

            <div className="color-picker-presets">
              {presets.map((p) => (
                <button 
                  key={p} 
                  className={`preset-btn ${p === value ? 'active' : ''}`}
                  style={{ backgroundColor: p }}
                  onClick={() => handlePresetClick(p)}
                  title={p}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
