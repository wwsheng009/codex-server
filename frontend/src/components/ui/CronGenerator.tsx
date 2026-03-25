import { useState, useEffect } from 'react'
import { SelectControl } from './SelectControl'
import { i18n } from '../../i18n/runtime'
import type { SelectOption } from './selectControlTypes'
import type { CronFieldProps, CronGeneratorProps } from './cronGeneratorTypes'

export function CronGenerator({ value, onChange }: CronGeneratorProps) {
  const parts = value.split(' ')
  const [minute, setMinute] = useState(parts[0] || '0')
  const [hour, setHour] = useState(parts[1] || '9')
  const [dom, setDom] = useState(parts[2] || '*')
  const [month, setMonth] = useState(parts[3] || '*')
  const [dow, setDow] = useState(parts[4] || '*')

  useEffect(() => {
    const cron = `${minute} ${hour} ${dom} ${month} ${dow}`
    if (cron !== value) {
      onChange(cron)
    }
  }, [minute, hour, dom, month, dow, value, onChange])

  return (
    <div className="cron-generator">
      <div className="cron-generator__grid">
        <CronField 
          label={i18n._({ id: 'Minute', message: 'Minute' })} 
          value={minute} 
          onChange={setMinute} 
          options={generateOptions(0, 59, i18n._({ id: 'Minute', message: 'Minute' }))} 
        />
        <CronField 
          label={i18n._({ id: 'Hour', message: 'Hour' })} 
          value={hour} 
          onChange={setHour} 
          options={generateOptions(0, 23, i18n._({ id: 'Hour', message: 'Hour' }))} 
        />
        <CronField 
          label={i18n._({ id: 'Day', message: 'Day' })} 
          value={dom} 
          onChange={setDom} 
          options={generateOptions(1, 31, i18n._({ id: 'Day', message: 'Day' }))} 
        />
        <CronField 
          label={i18n._({ id: 'Month', message: 'Month' })} 
          value={month} 
          onChange={setMonth} 
          options={[
            { value: '*', label: i18n._({ id: 'Every Month', message: 'Every Month' }) },
            { value: '1', label: i18n._({ id: 'January', message: 'January' }) },
            { value: '2', label: i18n._({ id: 'February', message: 'February' }) },
            { value: '3', label: i18n._({ id: 'March', message: 'March' }) },
            { value: '4', label: i18n._({ id: 'April', message: 'April' }) },
            { value: '5', label: i18n._({ id: 'May', message: 'May' }) },
            { value: '6', label: i18n._({ id: 'June', message: 'June' }) },
            { value: '7', label: i18n._({ id: 'July', message: 'July' }) },
            { value: '8', label: i18n._({ id: 'August', message: 'August' }) },
            { value: '9', label: i18n._({ id: 'September', message: 'September' }) },
            { value: '10', label: i18n._({ id: 'October', message: 'October' }) },
            { value: '11', label: i18n._({ id: 'November', message: 'November' }) },
            { value: '12', label: i18n._({ id: 'December', message: 'December' }) },
          ]} 
        />
        <CronField 
          label={i18n._({ id: 'Weekday', message: 'Weekday' })} 
          value={dow} 
          onChange={setDow} 
          options={[
            { value: '*', label: i18n._({ id: 'Every Day', message: 'Every Day' }) },
            { value: '1-5', label: i18n._({ id: 'Workdays (Mon-Fri)', message: 'Workdays (Mon-Fri)' }) },
            { value: '0,6', label: i18n._({ id: 'Weekends (Sat-Sun)', message: 'Weekends (Sat-Sun)' }) },
            { value: '1', label: i18n._({ id: 'Monday', message: 'Monday' }) },
            { value: '2', label: i18n._({ id: 'Tuesday', message: 'Tuesday' }) },
            { value: '3', label: i18n._({ id: 'Wednesday', message: 'Wednesday' }) },
            { value: '4', label: i18n._({ id: 'Thursday', message: 'Thursday' }) },
            { value: '5', label: i18n._({ id: 'Friday', message: 'Friday' }) },
            { value: '6', label: i18n._({ id: 'Saturday', message: 'Saturday' }) },
            { value: '0', label: i18n._({ id: 'Sunday', message: 'Sunday' }) },
          ]} 
        />
      </div>
      <div className="cron-generator__preview">
        <span>{i18n._({ id: 'Preview:', message: 'Preview:' })}</span>
        <code>{minute} {hour} {dom} {month} {dow}</code>
      </div>
    </div>
  )
}

function CronField({ label, value, onChange, options }: CronFieldProps) {
  return (
    <div className="cron-field">
      <span className="cron-field__label">{label}</span>
      <SelectControl
        ariaLabel={label}
        fullWidth
        onChange={onChange}
        options={options}
        value={value}
      />
    </div>
  )
}

function generateOptions(start: number, end: number, labelPrefix: string): SelectOption[] {
  const options: SelectOption[] = [
    {
      value: '*',
      label: i18n._({
        id: 'Every {label}',
        message: 'Every {label}',
        values: { label: labelPrefix },
      }),
    },
  ]
  for (let i = start; i <= end; i++) {
    options.push({ value: i.toString(), label: i.toString().padStart(2, '0') })
  }
  return options
}
