package scheduleutil

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

func Normalize(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "", "manual", "disabled":
		return ""
	case "hourly":
		return "0 * * * *"
	case "daily":
		return "0 9 * * *"
	case "weekly":
		return "0 9 * * 1"
	case "monthly":
		return "0 9 1 * *"
	}

	if strings.HasPrefix(normalized, "daily-") && len(normalized) == len("daily-0900") {
		hour, minute, ok := parseCompactTime(normalized[len("daily-"):])
		if ok {
			return fmt.Sprintf("%d %d * * *", minute, hour)
		}
	}

	if strings.HasPrefix(normalized, "weekly-") && len(normalized) == len("weekly-1-0900") {
		parts := strings.Split(normalized, "-")
		if len(parts) == 3 {
			day, dayErr := strconv.Atoi(parts[1])
			hour, minute, timeOK := parseCompactTime(parts[2])
			if dayErr == nil && timeOK {
				return fmt.Sprintf("%d %d * * %d", minute, hour, day)
			}
		}
	}

	if strings.HasPrefix(normalized, "monthly-") && len(normalized) == len("monthly-01-0900") {
		parts := strings.Split(normalized, "-")
		if len(parts) == 3 {
			day, dayErr := strconv.Atoi(parts[1])
			hour, minute, timeOK := parseCompactTime(parts[2])
			if dayErr == nil && timeOK {
				return fmt.Sprintf("%d %d %d * *", minute, hour, day)
			}
		}
	}

	return strings.TrimSpace(value)
}

func Label(schedule string) string {
	normalized := strings.TrimSpace(schedule)
	switch normalized {
	case "":
		return "Manual only"
	case "0 * * * *":
		return "Every hour"
	}

	fields := strings.Fields(normalized)
	if len(fields) == 5 {
		minute, hour, dayOfMonth, month, dayOfWeek := fields[0], fields[1], fields[2], fields[3], fields[4]
		if dayOfMonth == "*" && month == "*" && dayOfWeek == "*" && hour != "*" && minute != "*" {
			return fmt.Sprintf("Daily at %s", formatClockLabel(hour, minute))
		}
		if dayOfMonth == "*" && month == "*" && dayOfWeek != "*" && hour != "*" && minute != "*" {
			return fmt.Sprintf("Weekly on %s at %s", weekdayLabel(dayOfWeek), formatClockLabel(hour, minute))
		}
		if dayOfMonth != "*" && month == "*" && dayOfWeek == "*" && hour != "*" && minute != "*" {
			return fmt.Sprintf("Monthly on day %s at %s", dayOfMonth, formatClockLabel(hour, minute))
		}
	}

	if NextRunAt(time.Now().UTC(), normalized, time.Local) == nil {
		return "Manual only"
	}
	return "Cron: " + normalized
}

func NextRunAt(now time.Time, schedule string, location *time.Location) *time.Time {
	if strings.TrimSpace(schedule) == "" {
		return nil
	}
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	parsed, err := parser.Parse(schedule)
	if err != nil {
		return nil
	}
	next := parsed.Next(now.In(location))
	nextUTC := next.UTC()
	return &nextUTC
}

func parseCompactTime(value string) (int, int, bool) {
	if len(value) != 4 {
		return 0, 0, false
	}
	hour, hourErr := strconv.Atoi(value[:2])
	minute, minuteErr := strconv.Atoi(value[2:])
	if hourErr != nil || minuteErr != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
}

func formatClockLabel(hour string, minute string) string {
	trimmedHour := strings.TrimSpace(hour)
	trimmedMinute := strings.TrimSpace(minute)
	if len(trimmedHour) == 1 {
		trimmedHour = "0" + trimmedHour
	}
	if len(trimmedMinute) == 1 {
		trimmedMinute = "0" + trimmedMinute
	}
	return fmt.Sprintf("%s:%s", trimmedHour, trimmedMinute)
}

func weekdayLabel(value string) string {
	switch strings.TrimSpace(value) {
	case "0":
		return "Sunday"
	case "1":
		return "Monday"
	case "2":
		return "Tuesday"
	case "3":
		return "Wednesday"
	case "4":
		return "Thursday"
	case "5":
		return "Friday"
	case "6":
		return "Saturday"
	default:
		return value
	}
}
