export function getCompletedCommandOutputDelta(current: string, final: string) {
  if (!final) {
    return ''
  }

  if (!current) {
    return final
  }

  if (final.startsWith(current)) {
    return final.slice(current.length)
  }

  if (current.endsWith(final) || final.endsWith(current)) {
    return ''
  }

  const embeddedIndex = final.lastIndexOf(current)
  if (embeddedIndex >= 0) {
    return final.slice(embeddedIndex + current.length)
  }

  const maxOverlap = Math.min(current.length, final.length)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.endsWith(final.slice(0, overlap))) {
      return final.slice(overlap)
    }
  }

  return final
}
