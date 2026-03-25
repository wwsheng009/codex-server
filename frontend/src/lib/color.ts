import type { HSV, RGB } from './colorTypes'
export type { HSV, RGB } from './colorTypes'

export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255

  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max

  if (max !== min) {
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / d + 2
        break
      case bNorm:
        h = (rNorm - gNorm) / d + 4
        break
    }
    h /= 6
  }

  return { h: h * 360, s: s * 100, v: v * 100 }
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hNorm = h / 360
  const sNorm = s / 100
  const vNorm = v / 100

  let r = 0, g = 0, b = 0

  const i = Math.floor(hNorm * 6)
  const f = hNorm * 6 - i
  const p = vNorm * (1 - sNorm)
  const q = vNorm * (1 - f * sNorm)
  const t = vNorm * (1 - (1 - f) * sNorm)

  switch (i % 6) {
    case 0: r = vNorm, g = t, b = p; break
    case 1: r = q, g = vNorm, b = p; break
    case 2: r = p, g = vNorm, b = t; break
    case 3: r = p, g = q, b = vNorm; break
    case 4: r = t, g = p, b = vNorm; break
    case 5: r = vNorm, g = p, b = q; break
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  }
}

export function isValidHex(hex: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(hex)
}
