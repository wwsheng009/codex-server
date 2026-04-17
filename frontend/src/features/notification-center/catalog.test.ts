import { describe, expect, it } from 'vitest'
import {
  getNotificationChannelProvider,
  getNotificationTopicDefinition,
  notificationChannelTargetRefTypes,
  notificationTopicCatalog,
} from './catalog'

describe('notification center catalog', () => {
  it('keeps bot topics mapped to bot delivery targets instead of provider-specific targets', () => {
    expect(notificationChannelTargetRefTypes.bot).toEqual(['bot_delivery_target'])
    expect(notificationChannelTargetRefTypes.email).toEqual(['email_target'])
    expect(getNotificationChannelProvider('bot')).toBe('bots/telegram/wechat')
  })

  it('exposes normalized topics for frontend configuration', () => {
    const topics = notificationTopicCatalog.map((item) => item.topic)
    expect(topics).toContain('hook.blocked')
    expect(topics).toContain('turn.started')
    expect(topics).toContain('turn.completed')
    expect(topics).toContain('turn.failed')
    expect(topics).toContain('turn.interrupted')
    expect(topics).toContain('turn.cancelled')
    expect(topics).toContain('automation.skipped')
    expect(topics).toContain('automation.failed')
    expect(getNotificationTopicDefinition('system.notification.created')?.sourceType).toBe('notification')
    expect(getNotificationTopicDefinition('turn.started')?.sourceType).toBe('turn')
    expect(getNotificationTopicDefinition('turn.completed')?.sourceType).toBe('turn')
    expect(getNotificationTopicDefinition('turn.failed')?.sourceType).toBe('turn')
    expect(getNotificationTopicDefinition('turn.interrupted')?.sourceType).toBe('turn')
    expect(getNotificationTopicDefinition('turn.cancelled')?.sourceType).toBe('turn')
    expect(getNotificationTopicDefinition('automation.skipped')?.sourceType).toBe('automation')
  })
})
