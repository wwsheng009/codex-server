export type NotificationTopicDefinition = {
  topic: string
  defaultChannels: string[]
  sourceType: string
}

export const notificationTopicCatalog: NotificationTopicDefinition[] = [
  {
    topic: 'hook.blocked',
    defaultChannels: ['in_app', 'bot', 'email'],
    sourceType: 'hook',
  },
  {
    topic: 'hook.failed',
    defaultChannels: ['in_app', 'email'],
    sourceType: 'hook',
  },
  {
    topic: 'hook.continue_turn',
    defaultChannels: ['in_app'],
    sourceType: 'hook',
  },
  {
    topic: 'turn.started',
    defaultChannels: ['in_app'],
    sourceType: 'turn',
  },
  {
    topic: 'turn.completed',
    defaultChannels: ['in_app'],
    sourceType: 'turn',
  },
  {
    topic: 'turn.failed',
    defaultChannels: ['in_app'],
    sourceType: 'turn',
  },
  {
    topic: 'turn.interrupted',
    defaultChannels: ['in_app'],
    sourceType: 'turn',
  },
  {
    topic: 'turn.cancelled',
    defaultChannels: ['in_app'],
    sourceType: 'turn',
  },
  {
    topic: 'automation.completed',
    defaultChannels: ['in_app'],
    sourceType: 'automation',
  },
  {
    topic: 'automation.skipped',
    defaultChannels: ['in_app'],
    sourceType: 'automation',
  },
  {
    topic: 'automation.failed',
    defaultChannels: ['in_app', 'email'],
    sourceType: 'automation',
  },
  {
    topic: 'turn_policy.failed_action',
    defaultChannels: ['in_app'],
    sourceType: 'turn_policy',
  },
  {
    topic: 'bot.delivery.failed',
    defaultChannels: ['in_app', 'email'],
    sourceType: 'bot',
  },
  {
    topic: 'system.notification.created',
    defaultChannels: ['bot'],
    sourceType: 'notification',
  },
]

export const notificationChannels = ['in_app', 'bot', 'email'] as const
export type NotificationChannel = (typeof notificationChannels)[number]

export const notificationChannelTargetRefTypes: Record<NotificationChannel, string[]> = {
  in_app: ['workspace'],
  bot: ['bot_delivery_target'],
  email: ['email_target'],
}

export function getNotificationTopicDefinition(topic: string) {
  return notificationTopicCatalog.find((item) => item.topic === topic)
}

export function getNotificationChannelProvider(channel: NotificationChannel) {
  switch (channel) {
    case 'bot':
      return 'bots/telegram/wechat'
    case 'email':
      return 'email'
    default:
      return 'notificationcenter'
  }
}
