import { i18n } from '../i18n/runtime'

export function getScheduleType(schedule: string) {
  const normalized = schedule.trim()
  if (!normalized || normalized === 'manual') {
    return 'manual'
  }
  if (normalized === '0 * * * *' || normalized === 'hourly') {
    return 'hourly'
  }
  if (normalized.startsWith('daily-')) {
    return 'daily'
  }
  if (normalized.startsWith('weekly-')) {
    return 'weekly'
  }
  if (normalized.startsWith('monthly-')) {
    return 'monthly'
  }
  return 'cron'
}

export function formatScheduleLabel(schedule: string) {
  const normalized = schedule.trim()

  if (!normalized) {
    return i18n._({ id: 'Scheduled', message: 'Scheduled' })
  }

  if (normalized === '0 * * * *') {
    return i18n._({ id: 'Every hour', message: 'Every hour' })
  }

  const fields = normalized.split(/\s+/)
  if (fields.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields

    if (hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return i18n._({
        id: 'Daily at {time}',
        message: 'Daily at {time}',
        values: { time: formatScheduleTime(hour, minute) },
      })
    }

    if (hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      return i18n._({
        id: 'Weekly on {day} at {time}',
        message: 'Weekly on {day} at {time}',
        values: {
          day: formatScheduleWeekday(dayOfWeek),
          time: formatScheduleTime(hour, minute),
        },
      })
    }

    if (hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
      return i18n._({
        id: 'Monthly on day {day} at {time}',
        message: 'Monthly on day {day} at {time}',
        values: {
          day: dayOfMonth,
          time: formatScheduleTime(hour, minute),
        },
      })
    }
  }

  return i18n._({
    id: 'Cron: {schedule}',
    message: 'Cron: {schedule}',
    values: { schedule: normalized },
  })
}

function formatScheduleTime(hour: string, minute: string) {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

function formatScheduleWeekday(day: string) {
  switch (day) {
    case '0':
      return i18n._({ id: 'Sunday', message: 'Sunday' })
    case '1':
      return i18n._({ id: 'Monday', message: 'Monday' })
    case '2':
      return i18n._({ id: 'Tuesday', message: 'Tuesday' })
    case '3':
      return i18n._({ id: 'Wednesday', message: 'Wednesday' })
    case '4':
      return i18n._({ id: 'Thursday', message: 'Thursday' })
    case '5':
      return i18n._({ id: 'Friday', message: 'Friday' })
    case '6':
      return i18n._({ id: 'Saturday', message: 'Saturday' })
    default:
      return day
  }
}
