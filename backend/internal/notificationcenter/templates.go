package notificationcenter

import (
	"strings"
)

func renderTemplate(template string, event normalizedEvent, fallback string) string {
	trimmedTemplate := strings.TrimSpace(template)
	if trimmedTemplate == "" {
		return strings.TrimSpace(fallback)
	}

	values := templateValues(event)
	rendered := trimmedTemplate
	for key, value := range values {
		rendered = strings.ReplaceAll(rendered, "{{"+key+"}}", value)
		rendered = strings.ReplaceAll(rendered, "{"+key+"}", value)
	}
	return strings.TrimSpace(rendered)
}

func composeBotMessage(title string, message string) string {
	trimmedTitle := strings.TrimSpace(title)
	trimmedMessage := strings.TrimSpace(message)
	switch {
	case trimmedTitle == "" && trimmedMessage == "":
		return ""
	case trimmedTitle == "":
		return trimmedMessage
	case trimmedMessage == "", trimmedMessage == trimmedTitle:
		return trimmedTitle
	default:
		return trimmedTitle + "\n" + trimmedMessage
	}
}

func templateValues(event normalizedEvent) map[string]string {
	values := map[string]string{
		"workspaceId":   strings.TrimSpace(event.WorkspaceID),
		"threadId":      strings.TrimSpace(event.ThreadID),
		"turnId":        strings.TrimSpace(event.TurnID),
		"method":        strings.TrimSpace(event.Method),
		"topic":         strings.TrimSpace(event.Topic),
		"sourceType":    strings.TrimSpace(event.SourceType),
		"sourceRefType": strings.TrimSpace(event.SourceRefType),
		"sourceRefId":   strings.TrimSpace(event.SourceRefID),
		"eventKey":      strings.TrimSpace(event.EventKey),
		"level":         strings.TrimSpace(event.Level),
		"title":         strings.TrimSpace(event.Title),
		"message":       strings.TrimSpace(event.Message),
	}
	for key, value := range event.Attributes {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		values[trimmedKey] = strings.TrimSpace(value)
	}
	return values
}
