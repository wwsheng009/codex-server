package feishutools

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	calendarFreebusyPath        = "/open-apis/calendar/v4/freebusy/list"
	calendarCalendarsPath       = "/open-apis/calendar/v4/calendars"
	calendarPrimaryPath         = "/open-apis/calendar/v4/calendars/primary"
	calendarCalendarPathTmpl    = "/open-apis/calendar/v4/calendars/%s"
	calendarEventsPathTemplate  = "/open-apis/calendar/v4/calendars/%s/events"
	calendarEventPathTemplate   = "/open-apis/calendar/v4/calendars/%s/events/%s"
	calendarEventSearchTemplate = "/open-apis/calendar/v4/calendars/%s/events/search"
	calendarEventReplyTemplate  = "/open-apis/calendar/v4/calendars/%s/events/%s/reply"
	calendarEventInstancesTmpl  = "/open-apis/calendar/v4/calendars/%s/events/%s/instances"
	calendarEventInstanceView   = "/open-apis/calendar/v4/calendars/%s/events/instance_view"
	calendarEventAttendeesTmpl  = "/open-apis/calendar/v4/calendars/%s/events/%s/attendees"
)

func (s *Service) runCalendarFreebusy(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	body := map[string]any{}
	for _, key := range []string{"time_min", "time_max", "user_id", "room_id", "include_external_calendar", "only_busy", "need_rsvp_status"} {
		if value, ok := params[key]; ok {
			body[key] = value
		}
	}
	if _, ok := body["time_min"]; !ok {
		if value := strings.TrimSpace(stringParam(params, "timeMin")); value != "" {
			body["time_min"] = value
		}
	}
	if _, ok := body["time_max"]; !ok {
		if value := strings.TrimSpace(stringParam(params, "timeMax")); value != "" {
			body["time_max"] = value
		}
	}
	if _, ok := body["user_id"]; !ok {
		if value := strings.TrimSpace(stringParam(params, "userId")); value != "" {
			body["user_id"] = value
		}
	}
	if _, ok := body["room_id"]; !ok {
		if value := strings.TrimSpace(stringParam(params, "roomId")); value != "" {
			body["room_id"] = value
		}
	}
	for _, pair := range []struct{ camel, snake string }{{"includeExternalCalendar", "include_external_calendar"}, {"onlyBusy", "only_busy"}, {"needRsvpStatus", "need_rsvp_status"}} {
		if _, ok := body[pair.snake]; !ok {
			if value, ok := boolParam(params, pair.camel); ok {
				body[pair.snake] = value
			}
		}
	}
	if body["time_min"] == nil || body["time_max"] == nil {
		return nil, toolInvalidInput("timeMin/timeMax is required")
	}
	if body["user_id"] == nil && body["room_id"] == nil {
		return nil, toolInvalidInput("userId or roomId is required")
	}

	query := url.Values{}
	if userIDType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); userIDType != "" {
		query.Set("user_id_type", userIDType)
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", calendarFreebusyPath, query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEvent(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runCalendarEventCreate(ctx, workspaceID, config, params)
	case "list":
		return s.runCalendarEventList(ctx, workspaceID, config, params)
	case "get":
		return s.runCalendarEventGet(ctx, workspaceID, config, params)
	case "patch":
		return s.runCalendarEventPatch(ctx, workspaceID, config, params)
	case "delete":
		return s.runCalendarEventDelete(ctx, workspaceID, config, params)
	case "search":
		return s.runCalendarEventSearch(ctx, workspaceID, config, params)
	case "reply":
		return s.runCalendarEventReply(ctx, workspaceID, config, params)
	case "instances":
		return s.runCalendarEventInstances(ctx, workspaceID, config, params)
	case "instance_view":
		return s.runCalendarEventInstanceView(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_calendar_event", action))
	}
}

func (s *Service) runCalendar(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	return s.runCalendarCalendar(ctx, workspaceID, config, action, params)
}

func (s *Service) runCalendarCalendar(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "list":
		return s.runCalendarCalendarList(ctx, workspaceID, config, params)
	case "get":
		return s.runCalendarCalendarGet(ctx, workspaceID, config, params)
	case "primary":
		return s.runCalendarCalendarPrimary(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_calendar_calendar", action))
	}
}

func (s *Service) runCalendarCalendarList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "page_size"}, map[string]string{"pageToken": "page_token", "pageSize": "page_size"})
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", calendarCalendarsPath, query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarCalendarGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	if calendarID == "" {
		return nil, toolInvalidInput("calendarId is required")
	}
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(calendarCalendarPathTmpl, url.PathEscape(calendarID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarCalendarPrimary(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	snapshot, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	if userIDType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); userIDType != "" {
		query.Set("user_id_type", userIDType)
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", calendarPrimaryPath, query, snapshot.AccessToken, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = "user"
	return result, nil
}

func (s *Service) runCalendarEventAttendee(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runCalendarEventAttendeeCreate(ctx, workspaceID, config, params)
	case "list":
		return s.runCalendarEventAttendeeList(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_calendar_event_attendee", action))
	}
}

func (s *Service) runCalendarEventAttendeeCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	body := mapWithout(params, "calendarId", "calendar_id", "eventId", "event_id", "userIdType", "user_id_type")
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(calendarEventAttendeesTmpl, url.PathEscape(calendarID), url.PathEscape(eventID)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventAttendeeList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "page_size"}, map[string]string{"pageToken": "page_token", "pageSize": "page_size"})
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(calendarEventAttendeesTmpl, url.PathEscape(calendarID), url.PathEscape(eventID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	if calendarID == "" {
		return nil, toolInvalidInput("calendarId is required")
	}
	body := mapWithout(params, "calendarId", "calendar_id", "userIdType", "user_id_type")
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(calendarEventsPathTemplate, url.PathEscape(calendarID)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	return s.runCalendarEventInstanceView(ctx, workspaceID, config, params)
}

func (s *Service) runCalendarEventInstanceView(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	if calendarID == "" {
		return nil, toolInvalidInput("calendarId is required")
	}
	startTime, err := parseCalendarTimeParam(params, "startTime", "start_time")
	if err != nil {
		return nil, toolInvalidInput("startTime is required and must be RFC3339")
	}
	endTime, err := parseCalendarTimeParam(params, "endTime", "end_time")
	if err != nil {
		return nil, toolInvalidInput("endTime is required and must be RFC3339")
	}

	snapshot, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("start_time", startTime)
	query.Set("end_time", endTime)
	query.Set("user_id_type", firstNonEmpty(strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")), "open_id"))
	copyQueryFields(query, params, []string{"page_token", "page_size"}, map[string]string{"pageToken": "page_token", "pageSize": "page_size"})
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(calendarEventInstanceView, url.PathEscape(calendarID)), query, snapshot.AccessToken, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = "user"
	return result, nil
}

func (s *Service) runCalendarEventGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(calendarEventPathTemplate, url.PathEscape(calendarID), url.PathEscape(eventID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventPatch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	body := mapWithout(params, "calendarId", "calendar_id", "eventId", "event_id", "userIdType", "user_id_type")
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(calendarEventPathTemplate, url.PathEscape(calendarID), url.PathEscape(eventID)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventDelete(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "DELETE", fmt.Sprintf(calendarEventPathTemplate, url.PathEscape(calendarID), url.PathEscape(eventID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventSearch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	if calendarID == "" {
		return nil, toolInvalidInput("calendarId is required")
	}
	body := mapWithout(params, "calendarId", "calendar_id", "userIdType", "user_id_type")
	token, query, err := s.calendarTokenAndQuery(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(calendarEventSearchTemplate, url.PathEscape(calendarID)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runCalendarEventReply(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	rsvpStatus := strings.TrimSpace(stringParam(params, "rsvpStatus", "rsvp_status"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	if rsvpStatus == "" {
		return nil, toolInvalidInput("rsvpStatus is required")
	}

	snapshot, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var upstream map[string]any
	if err := s.gateway.doJSON(
		ctx,
		"POST",
		fmt.Sprintf(calendarEventReplyTemplate, url.PathEscape(calendarID), url.PathEscape(eventID)),
		nil,
		snapshot.AccessToken,
		map[string]any{"rsvp_status": rsvpStatus},
		&upstream,
	); err != nil {
		return nil, err
	}

	result := map[string]any{
		"success":    true,
		"eventId":    eventID,
		"rsvpStatus": rsvpStatus,
		"principal":  "user",
	}
	if len(upstream) > 0 {
		result["upstream"] = upstream
	}
	return result, nil
}

func (s *Service) runCalendarEventInstances(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	calendarID := strings.TrimSpace(stringParam(params, "calendarId", "calendar_id"))
	eventID := strings.TrimSpace(stringParam(params, "eventId", "event_id"))
	if calendarID == "" || eventID == "" {
		return nil, toolInvalidInput("calendarId and eventId are required")
	}
	startTime, err := parseCalendarTimeParam(params, "startTime", "start_time")
	if err != nil {
		return nil, toolInvalidInput("startTime is required and must be RFC3339")
	}
	endTime, err := parseCalendarTimeParam(params, "endTime", "end_time")
	if err != nil {
		return nil, toolInvalidInput("endTime is required and must be RFC3339")
	}

	snapshot, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	query.Set("start_time", startTime)
	query.Set("end_time", endTime)
	copyQueryFields(query, params, []string{"page_token", "page_size"}, map[string]string{"pageToken": "page_token", "pageSize": "page_size"})

	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(calendarEventInstancesTmpl, url.PathEscape(calendarID), url.PathEscape(eventID)), query, snapshot.AccessToken, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = "user"
	return result, nil
}

func (s *Service) calendarTokenAndQuery(ctx context.Context, workspaceID string, config Config, params map[string]any) (bearerChoice, url.Values, error) {
	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return bearerChoice{}, nil, err
	}
	query := url.Values{}
	if userIDType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); userIDType != "" {
		query.Set("user_id_type", userIDType)
	}
	return token, query, nil
}

func mapWithout(params map[string]any, keys ...string) map[string]any {
	blocked := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		blocked[key] = struct{}{}
	}
	result := make(map[string]any, len(params))
	for key, value := range params {
		if _, ok := blocked[key]; ok {
			continue
		}
		result[key] = value
	}
	return result
}

func copyQueryFields(target url.Values, params map[string]any, snakeKeys []string, aliases map[string]string) {
	for _, key := range snakeKeys {
		if value := strings.TrimSpace(stringParam(params, key)); value != "" {
			target.Set(key, value)
		}
	}
	for alias, targetKey := range aliases {
		if value := strings.TrimSpace(stringParam(params, alias)); value != "" {
			target.Set(targetKey, value)
		}
	}
	for _, targetKey := range []string{"page_size"} {
		if _, ok := target[targetKey]; !ok {
			for alias, mapped := range aliases {
				if mapped == targetKey {
					if value, ok := intParam(params, alias); ok && value > 0 {
						target.Set(targetKey, fmt.Sprintf("%d", value))
					}
				}
			}
			if value, ok := intParam(params, targetKey); ok && value > 0 {
				target.Set(targetKey, fmt.Sprintf("%d", value))
			}
		}
	}
}

func parseCalendarTimeParam(params map[string]any, keys ...string) (string, error) {
	value := strings.TrimSpace(stringParam(params, keys...))
	if value == "" {
		return "", fmt.Errorf("missing time")
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d", parsed.Unix()), nil
}
