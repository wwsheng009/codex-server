package notifications

import "codex-server/backend/internal/store"

type Service struct {
	store *store.MemoryStore
}

func NewService(dataStore *store.MemoryStore) *Service {
	return &Service{store: dataStore}
}

func (s *Service) Create(notification store.Notification) (store.Notification, error) {
	return s.store.CreateNotification(notification)
}

func (s *Service) List() []store.Notification {
	return s.store.ListNotifications()
}

func (s *Service) MarkRead(notificationID string) (store.Notification, error) {
	return s.store.MarkNotificationRead(notificationID)
}

func (s *Service) MarkAllRead() []store.Notification {
	return s.store.MarkAllNotificationsRead()
}

func (s *Service) DeleteRead() []store.Notification {
	return s.store.DeleteReadNotifications()
}
