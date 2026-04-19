import { Button } from './Button'
import { CronGenerator } from './CronGenerator'
import { Input } from './Input'
import { Modal } from './Modal'
import { SelectControl } from './SelectControl'
import { i18n } from '../../i18n/runtime'
import { getScheduleType } from '../../lib/schedule'

type ScheduleEditorProps = {
  schedule: string
  manualLabel?: string
  onChange: (schedule: string) => void
  cronPickerOpen: boolean
  onCronPickerOpenChange: (open: boolean) => void
}

function getFrequencyOptions(includeManual: boolean) {
  return [
    ...(includeManual ? [{ value: 'manual', label: i18n._({ id: 'Manual only', message: 'Manual only' }) }] : []),
    { value: 'hourly', label: i18n._({ id: 'Hourly', message: 'Hourly' }) },
    { value: 'daily', label: i18n._({ id: 'Daily', message: 'Daily' }) },
    { value: 'weekly', label: i18n._({ id: 'Weekly', message: 'Weekly' }) },
    { value: 'monthly', label: i18n._({ id: 'Monthly', message: 'Monthly' }) },
    { value: 'cron', label: i18n._({ id: 'Advanced (Cron)', message: 'Advanced (Cron)' }) },
  ]
}

function getWeekdayOptions() {
  return [
    { value: '0', label: i18n._({ id: 'Sunday', message: 'Sunday' }) },
    { value: '1', label: i18n._({ id: 'Monday', message: 'Monday' }) },
    { value: '2', label: i18n._({ id: 'Tuesday', message: 'Tuesday' }) },
    { value: '3', label: i18n._({ id: 'Wednesday', message: 'Wednesday' }) },
    { value: '4', label: i18n._({ id: 'Thursday', message: 'Thursday' }) },
    { value: '5', label: i18n._({ id: 'Friday', message: 'Friday' }) },
    { value: '6', label: i18n._({ id: 'Saturday', message: 'Saturday' }) },
  ]
}

export function ScheduleEditor({
  schedule,
  manualLabel = 'manual',
  onChange,
  cronPickerOpen,
  onCronPickerOpenChange,
}: ScheduleEditorProps) {
  const frequencyOptions = getFrequencyOptions(manualLabel === 'manual')
  const weekdayOptions = getWeekdayOptions()
  const scheduleType = getScheduleType(schedule)

  return (
    <>
      <label className="field">
        <span>{i18n._({ id: 'Frequency', message: 'Frequency' })}</span>
        <SelectControl
          ariaLabel={i18n._({ id: 'Frequency', message: 'Frequency' })}
          fullWidth
          value={scheduleType}
          onChange={(nextValue) => {
            let baseSchedule = manualLabel
            if (nextValue === 'hourly') baseSchedule = '0 * * * *'
            if (nextValue === 'daily') baseSchedule = 'daily-0900'
            if (nextValue === 'weekly') baseSchedule = 'weekly-1-0900'
            if (nextValue === 'monthly') baseSchedule = 'monthly-01-0900'
            if (nextValue === 'cron') baseSchedule = '0 9 * * 1-5'
            onChange(baseSchedule)
          }}
          options={frequencyOptions}
        />
      </label>

      {schedule.startsWith('daily-') ? (
        <Input
          label={i18n._({ id: 'Run Time', message: 'Run Time' })}
          type="time"
          onChange={(event) => {
            const [hh, mm] = event.target.value.split(':')
            onChange(`daily-${hh}${mm}`)
          }}
          value={`${schedule.slice(6, 8)}:${schedule.slice(8, 10)}`}
        />
      ) : null}

      {schedule.startsWith('weekly-') ? (
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div className="field">
            <span>{i18n._({ id: 'Day', message: 'Day' })}</span>
            <SelectControl
              ariaLabel={i18n._({ id: 'Day of Week', message: 'Day of Week' })}
              fullWidth
              onChange={(day) => {
                const time = schedule.slice(9)
                onChange(`weekly-${day}-${time}`)
              }}
              options={weekdayOptions}
              value={schedule.slice(7, 8)}
            />
          </div>
          <Input
            label={i18n._({ id: 'Time', message: 'Time' })}
            type="time"
            onChange={(event) => {
              const [hh, mm] = event.target.value.split(':')
              const day = schedule.slice(7, 8)
              onChange(`weekly-${day}-${hh}${mm}`)
            }}
            value={`${schedule.slice(9, 11)}:${schedule.slice(11, 13)}`}
          />
        </div>
      ) : null}

      {schedule.startsWith('monthly-') ? (
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Input
            label={i18n._({ id: 'Day of Month', message: 'Day of Month' })}
            type="number"
            min="1"
            max="31"
            onChange={(event) => {
              const day = event.target.value.padStart(2, '0')
              const time = schedule.slice(11)
              onChange(`monthly-${day}-${time}`)
            }}
            value={schedule.slice(8, 10)}
          />
          <Input
            label={i18n._({ id: 'Time', message: 'Time' })}
            type="time"
            onChange={(event) => {
              const [hh, mm] = event.target.value.split(':')
              const day = schedule.slice(8, 10)
              onChange(`monthly-${day}-${hh}${mm}`)
            }}
            value={`${schedule.slice(11, 13)}:${schedule.slice(13, 15)}`}
          />
        </div>
      ) : null}

      {scheduleType === 'cron' ? (
        <div className="field">
          <span>{i18n._({ id: 'Advanced Scheduling', message: 'Advanced Scheduling' })}</span>
          <div className="cron-trigger-area">
            <code>{schedule}</code>
            <Button intent="secondary" size="sm" onClick={() => onCronPickerOpenChange(true)}>
              {i18n._({ id: 'Edit', message: 'Edit' })}
            </Button>
          </div>
        </div>
      ) : null}

      {schedule === '0 * * * *' || schedule === 'hourly' ? (
        <div className="field">
          <span>{i18n._({ id: 'Interval', message: 'Interval' })}</span>
          <div style={{ padding: '12px 0', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            {i18n._({
              id: 'Runs once per hour, on the hour.',
              message: 'Runs once per hour, on the hour.',
            })}
          </div>
        </div>
      ) : null}

      {cronPickerOpen ? (
        <Modal
          onClose={() => onCronPickerOpenChange(false)}
          title={i18n._({
            id: 'Configure Advanced Schedule',
            message: 'Configure Advanced Schedule',
          })}
          description={i18n._({
            id: 'Use the visual generator below to define your execution frequency.',
            message: 'Use the visual generator below to define your execution frequency.',
          })}
          footer={
            <Button type="button" onClick={() => onCronPickerOpenChange(false)}>
              {i18n._({ id: 'Apply Schedule', message: 'Apply Schedule' })}
            </Button>
          }
        >
          <CronGenerator
            value={schedule === manualLabel ? '0 9 * * 1-5' : schedule}
            onChange={onChange}
          />
        </Modal>
      ) : null}
    </>
  )
}
