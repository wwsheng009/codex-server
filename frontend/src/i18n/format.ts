import { getActiveLocale } from './runtime'

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const timeFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>()

function getDateTimeFormatter(locale: string) {
  const existing = dateTimeFormatters.get(locale)
  if (existing) {
    return existing
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  dateTimeFormatters.set(locale, formatter)
  return formatter
}

function getTimeFormatter(locale: string) {
  const existing = timeFormatters.get(locale)
  if (existing) {
    return existing
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })

  timeFormatters.set(locale, formatter)
  return formatter
}

function getNumberFormatter(locale: string) {
  const existing = numberFormatters.get(locale)
  if (existing) {
    return existing
  }

  const formatter = new Intl.NumberFormat(locale)
  numberFormatters.set(locale, formatter)
  return formatter
}

function getRelativeTimeFormatter(locale: string) {
  const existing = relativeTimeFormatters.get(locale)
  if (existing) {
    return existing
  }

  const formatter = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'narrow',
  })

  relativeTimeFormatters.set(locale, formatter)
  return formatter
}

export function formatLocaleDateTime(value: string) {
  return getDateTimeFormatter(getActiveLocale()).format(new Date(value))
}

export function formatLocaleTime(value: string) {
  return getTimeFormatter(getActiveLocale()).format(new Date(value))
}

export function formatLocaleNumber(value: number) {
  return getNumberFormatter(getActiveLocale()).format(value)
}

export function formatRelativeTimeShort(value?: string) {
  const formatter = getRelativeTimeFormatter(getActiveLocale())

  if (!value) {
    return formatter.format(0, 'second')
  }

  const then = new Date(value).getTime()
  if (Number.isNaN(then)) {
    return formatter.format(0, 'second')
  }

  const deltaSeconds = Math.round((then - Date.now()) / 1000)
  const absoluteSeconds = Math.abs(deltaSeconds)

  if (absoluteSeconds >= 86_400) {
    return formatter.format(Math.round(deltaSeconds / 86_400), 'day')
  }

  if (absoluteSeconds >= 3_600) {
    return formatter.format(Math.round(deltaSeconds / 3_600), 'hour')
  }

  if (absoluteSeconds >= 60) {
    return formatter.format(Math.round(deltaSeconds / 60), 'minute')
  }

  return formatter.format(0, 'second')
}
