import { useState, useEffect } from 'react'
import { SelectControl } from './SelectControl'

interface CronGeneratorProps {
  value: string
  onChange: (cron: string) => void
}

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
          label="Minute" 
          value={minute} 
          onChange={setMinute} 
          options={generateOptions(0, 59, 'Minute')} 
        />
        <CronField 
          label="Hour" 
          value={hour} 
          onChange={setHour} 
          options={generateOptions(0, 23, 'Hour')} 
        />
        <CronField 
          label="Day" 
          value={dom} 
          onChange={setDom} 
          options={generateOptions(1, 31, 'Day')} 
        />
        <CronField 
          label="Month" 
          value={month} 
          onChange={setMonth} 
          options={[
            { value: '*', label: 'Every Month' },
            { value: '1', label: 'January' },
            { value: '2', label: 'February' },
            { value: '3', label: 'March' },
            { value: '4', label: 'April' },
            { value: '5', label: 'May' },
            { value: '6', label: 'June' },
            { value: '7', label: 'July' },
            { value: '8', label: 'August' },
            { value: '9', label: 'September' },
            { value: '10', label: 'October' },
            { value: '11', label: 'November' },
            { value: '12', label: 'December' },
          ]} 
        />
        <CronField 
          label="Weekday" 
          value={dow} 
          onChange={setDow} 
          options={[
            { value: '*', label: 'Every Day' },
            { value: '1-5', label: 'Workdays (Mon-Fri)' },
            { value: '0,6', label: 'Weekends (Sat-Sun)' },
            { value: '1', label: 'Monday' },
            { value: '2', label: 'Tuesday' },
            { value: '3', label: 'Wednesday' },
            { value: '4', label: 'Thursday' },
            { value: '5', label: 'Friday' },
            { value: '6', label: 'Saturday' },
            { value: '0', label: 'Sunday' },
          ]} 
        />
      </div>
      <div className="cron-generator__preview">
        <span>Preview:</span>
        <code>{minute} {hour} {dom} {month} {dow}</code>
      </div>
    </div>
  )
}

function CronField({ label, value, onChange, options }: any) {
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

function generateOptions(start: number, end: number, labelPrefix: string) {
  const options = [{ value: '*', label: `Every ${labelPrefix}` }]
  for (let i = start; i <= end; i++) {
    options.push({ value: i.toString(), label: i.toString().padStart(2, '0') })
  }
  return options
}
