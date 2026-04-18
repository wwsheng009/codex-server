package feishutools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnforceSensitiveWriteGuard(t *testing.T) {
	t.Parallel()

	err := enforceSensitiveWriteGuard(Config{SensitiveWriteGuard: true}, "feishu_calendar_event.delete")
	if err == nil {
		t.Fatalf("expected guard to block sensitive delete action")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "sensitive_write_guard" {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := enforceSensitiveWriteGuard(Config{SensitiveWriteGuard: true}, "feishu_calendar_event.patch"); err != nil {
		t.Fatalf("expected non-sensitive patch action to pass, got %v", err)
	}
	if err := enforceSensitiveWriteGuard(Config{SensitiveWriteGuard: true}, "feishu_im_user_message.send"); err == nil {
		t.Fatalf("expected guard to block user-send action")
	}
}

func TestRunCalendarFreebusyBuildsBody(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != calendarFreebusyPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"freebusy":"ok"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarFreebusy(context.Background(), "ws", validUserConfig(), map[string]any{
		"timeMin":        "2024-01-01T00:00:00Z",
		"timeMax":        "2024-01-02T00:00:00Z",
		"userId":         "ou_1",
		"needRsvpStatus": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["time_min"] != "2024-01-01T00:00:00Z" || received["user_id"] != "ou_1" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if _, ok := result["freebusy"]; !ok {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunCalendarEventCreateUsesCalendarPath(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/calendar/v4/calendars/cal_1/events" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"event":{"event_id":"evt_1"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"calendarId": "cal_1",
		"summary":    "Standup",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["summary"] != "Standup" {
		t.Fatalf("unexpected body: %#v", received)
	}
	if _, ok := result["event"]; !ok {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunCalendarEventDeleteRequiresIDs(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "delete", map[string]any{
		"calendarId": "cal_1",
	})
	if err == nil {
		t.Fatalf("expected missing eventId error")
	}
}

func TestRunCalendarEventListUsesInstanceViewAndUnixTimestamps(t *testing.T) {
	t.Parallel()

	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != "/open-apis/calendar/v4/calendars/cal_1/events/instance_view" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("start_time"); got != "1704067200" {
			t.Errorf("expected unix start_time, got %q", got)
		}
		if got := r.URL.Query().Get("end_time"); got != "1704153600" {
			t.Errorf("expected unix end_time, got %q", got)
		}
		if got := r.URL.Query().Get("user_id_type"); got != "open_id" {
			t.Errorf("expected user_id_type=open_id, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"event_id":"evt_1"}],"has_more":false}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"calendarId": "cal_1",
		"startTime":  "2024-01-01T00:00:00Z",
		"endTime":    "2024-01-02T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer u-access" {
		t.Fatalf("expected user token auth header, got %q", authHeader)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunCalendarEventReplyUsesUserToken(t *testing.T) {
	t.Parallel()

	var received map[string]any
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != "/open-apis/calendar/v4/calendars/cal_1/events/evt_1/reply" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"ok":true}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "reply", map[string]any{
		"calendarId": "cal_1",
		"eventId":    "evt_1",
		"rsvpStatus": "accept",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer u-access" {
		t.Fatalf("expected user token auth header, got %q", authHeader)
	}
	if received["rsvp_status"] != "accept" {
		t.Fatalf("unexpected reply body: %#v", received)
	}
	if result["rsvpStatus"] != "accept" || result["eventId"] != "evt_1" || result["success"] != true {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunCalendarEventReplyRequiresRsvpStatus(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "reply", map[string]any{
		"calendarId": "cal_1",
		"eventId":    "evt_1",
	})
	if err == nil {
		t.Fatalf("expected missing rsvpStatus error")
	}
}

func TestRunCalendarEventInstancesUsesDedicatedEndpoint(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/calendar/v4/calendars/cal_1/events/evt_1/instances" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("start_time"); got != "1704067200" {
			t.Errorf("expected unix start_time, got %q", got)
		}
		if got := r.URL.Query().Get("page_size"); got != "10" {
			t.Errorf("expected page_size=10, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"event_id":"evt_i1"}],"has_more":true,"page_token":"next"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "instances", map[string]any{
		"calendarId": "cal_1",
		"eventId":    "evt_1",
		"startTime":  "2024-01-01T00:00:00Z",
		"endTime":    "2024-01-02T00:00:00Z",
		"pageSize":   10,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["principal"] != "user" || result["page_token"] != "next" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunCalendarEventInstanceViewRequiresRfc3339(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runCalendarEvent(context.Background(), "ws", validUserConfig(), "instance_view", map[string]any{
		"calendarId": "cal_1",
		"startTime":  "2024-01-01",
		"endTime":    "2024-01-02T00:00:00Z",
	})
	if err == nil {
		t.Fatalf("expected invalid time error")
	}
}

func TestRunCalendarCalendarListFallsBackToTenantToken(t *testing.T) {
	t.Parallel()

	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == openAPITenantTokenPath {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"tenant_access_token":"tenant-access","expire":7200}`))
			return
		}
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != calendarCalendarsPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("page_size"); got != "25" {
			t.Errorf("expected page_size=25, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"calendar_id":"cal_1"}]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}
	result, err := service.runCalendarCalendar(context.Background(), "ws", config, "list", map[string]any{
		"pageSize": 25,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer tenant-access" {
		t.Fatalf("expected tenant token auth header, got %q", authHeader)
	}
	if result["principal"] != "tenant" {
		t.Fatalf("expected tenant principal, got %#v", result)
	}
}

func TestRunCalendarCalendarPrimaryUsesUserTokenAndUserIDType(t *testing.T) {
	t.Parallel()

	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != calendarPrimaryPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("user_id_type"); got != "open_id" {
			t.Errorf("expected user_id_type=open_id, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"calendar":{"calendar_id":"primary"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarCalendar(context.Background(), "ws", validUserConfig(), "primary", map[string]any{
		"userIdType": "open_id",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer u-access" {
		t.Fatalf("expected user token auth header, got %q", authHeader)
	}
	if result["principal"] != "user" {
		t.Fatalf("expected user principal, got %#v", result)
	}
}

func TestRunCalendarCalendarPrimaryRequiresUserToken(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}

	_, err := service.runCalendarCalendar(context.Background(), "ws", config, "primary", map[string]any{})
	if err == nil {
		t.Fatalf("expected user_oauth_required error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "user_oauth_required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunCalendarEventAttendeeCreateUsesAttendeePath(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/calendar/v4/calendars/cal_1/events/evt_1/attendees" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("user_id_type"); got != "open_id" {
			t.Errorf("expected user_id_type=open_id, got %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"attendees":[{"attendee_id":"ou_1"}]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runCalendarEventAttendee(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"calendarId": "cal_1",
		"eventId":    "evt_1",
		"userIdType": "open_id",
		"attendees": []map[string]any{
			{"attendee_id": "ou_1"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := received["attendees"]; !ok {
		t.Fatalf("unexpected attendee body: %#v", received)
	}
	if result["principal"] != "user" {
		t.Fatalf("expected user principal, got %#v", result)
	}
}

func TestRunCalendarEventAttendeeListRequiresIDs(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runCalendarEventAttendee(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"calendarId": "cal_1",
	})
	if err == nil {
		t.Fatalf("expected missing eventId error")
	}
}

func TestRunTaskListRequiresUserToken(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}
	_, err := service.runTask(context.Background(), "ws", config, "list", map[string]any{})
	if err == nil {
		t.Fatalf("expected user token requirement error")
	}
}

func TestRunTaskCreateUsesTaskPath(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != taskPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"task":{"guid":"t_1"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runTask(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"summary": "Ship Stage 5",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["summary"] != "Ship Stage 5" {
		t.Fatalf("unexpected task body: %#v", received)
	}
	if _, ok := result["task"]; !ok {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunTaskPatchRequiresTaskGuid(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runTask(context.Background(), "ws", validUserConfig(), "patch", map[string]any{})
	if err == nil {
		t.Fatalf("expected taskGuid required error")
	}
}

func TestRunTaskTasklistCreateUsesUserTokenAndTasklistPath(t *testing.T) {
	t.Parallel()

	var received map[string]any
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != tasklistPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"tasklist":{"guid":"tl_1"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runTaskTasklist(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"name": "Roadmap",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer u-access" {
		t.Fatalf("expected user token auth header, got %q", authHeader)
	}
	if received["name"] != "Roadmap" {
		t.Fatalf("unexpected body: %#v", received)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunTaskTasklistPatchRequiresFields(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runTaskTasklist(context.Background(), "ws", validUserConfig(), "patch", map[string]any{
		"tasklistGuid": "tl_1",
	})
	if err == nil {
		t.Fatalf("expected patch field validation error")
	}
}

func TestRunTaskSectionListRequiresUserToken(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}
	_, err := service.runTaskSection(context.Background(), "ws", config, "list", map[string]any{
		"resourceType": "tasklist",
		"resourceId":   "tl_1",
	})
	if err == nil {
		t.Fatalf("expected user token requirement error")
	}
}

func TestRunTaskSectionTasksBuildsQuery(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/task/v2/sections/sec_1/tasks" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("completed"); got != "true" {
			t.Errorf("unexpected completed query %q", got)
		}
		if got := r.URL.Query().Get("created_from"); got != "2024-01-01T00:00:00Z" {
			t.Errorf("unexpected created_from query %q", got)
		}
		if got := r.URL.Query().Get("page_size"); got != "20" {
			t.Errorf("unexpected page_size query %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runTaskSection(context.Background(), "ws", validUserConfig(), "tasks", map[string]any{
		"sectionGuid": "sec_1",
		"completed":   true,
		"createdFrom": "2024-01-01T00:00:00Z",
		"pageSize":    20,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunTaskSubtaskCreateUsesTaskScopedPath(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/task/v2/tasks/task_1/subtasks" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"subtask":{"guid":"sub_1"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runTaskSubtask(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"taskGuid": "task_1",
		"summary":  "Follow up",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["summary"] != "Follow up" {
		t.Fatalf("unexpected body: %#v", received)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunTaskCommentCreateBuildsTaskCommentBody(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != commentPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"comment":{"id":"c_1"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runTaskComment(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"taskGuid":         "task_1",
		"content":          "Need review",
		"replyToCommentId": "c_0",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["resource_type"] != "task" || received["resource_id"] != "task_1" {
		t.Fatalf("unexpected body: %#v", received)
	}
	if received["reply_to_comment_id"] != "c_0" {
		t.Fatalf("unexpected reply body: %#v", received)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunTaskCommentGetRequiresCommentID(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runTaskComment(context.Background(), "ws", validUserConfig(), "get", map[string]any{})
	if err == nil {
		t.Fatalf("expected commentId required error")
	}
}
