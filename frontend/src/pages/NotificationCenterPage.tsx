import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusPill } from '../components/ui/StatusPill'
import { Switch } from '../components/ui/Switch'
import { TextArea } from '../components/ui/TextArea'
import { listAvailableBotDeliveryTargets, listAvailableBots } from '../features/bots/api'
import {
  createNotificationEmailTarget,
  createNotificationSubscription,
  deleteNotificationSubscription,
  getNotificationMailServerConfig,
  listNotificationDispatches,
  listNotificationEmailTargets,
  listNotificationSubscriptions,
  retryNotificationDispatch,
  updateNotificationSubscription,
  upsertNotificationMailServerConfig,
} from '../features/notification-center/api'
import {
  getNotificationTopicDefinition,
  notificationTopicCatalog,
} from '../features/notification-center/catalog'
import { listWorkspaces } from '../features/workspaces/api'
import {
  formatLocalizedDateTime,
  formatLocalizedStatusLabel,
  humanizeDisplayValue,
} from '../i18n/display'
import { formatLocaleNumber } from '../i18n/format'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { useSessionStore } from '../stores/session-store'
import type {
  BotDeliveryTarget,
  NotificationMailServerConfig,
  NotificationSubscription,
} from '../types/api'

type SubscriptionDraft = {
  id: string | null
  topic: string
  filterText: string
  enabled: boolean
  inAppEnabled: boolean
  inAppTitleTemplate: string
  inAppBodyTemplate: string
  botEnabled: boolean
  botTargetId: string
  botTitleTemplate: string
  botBodyTemplate: string
  emailEnabled: boolean
  emailTargetId: string
  emailTitleTemplate: string
  emailBodyTemplate: string
}

type EmailTargetDraft = {
  name: string
  emailsText: string
  subjectTemplate: string
  bodyTemplate: string
  enabled: boolean
}

type MailServerDraft = {
  enabled: boolean
  host: string
  port: string
  username: string
  password: string
  clearSavedPassword: boolean
  from: string
  requireTls: boolean
  skipVerify: boolean
}

type DispatchFilterState = {
  topic: string
  channel: string
  status: string
}

type DeliveryTargetOption = BotDeliveryTarget & {
  botName: string
}

function isDeliveryTargetReady(target?: Pick<BotDeliveryTarget, 'deliveryReadiness'> | null) {
  return (target?.deliveryReadiness?.trim().toLowerCase() ?? 'ready') === 'ready'
}

const EMPTY_SUBSCRIPTION_DRAFT: SubscriptionDraft = {
  id: null,
  topic: notificationTopicCatalog[0]?.topic ?? 'hook.blocked',
  filterText: '',
  enabled: true,
  inAppEnabled: true,
  inAppTitleTemplate: '',
  inAppBodyTemplate: '',
  botEnabled: false,
  botTargetId: '',
  botTitleTemplate: '',
  botBodyTemplate: '',
  emailEnabled: false,
  emailTargetId: '',
  emailTitleTemplate: '',
  emailBodyTemplate: '',
}

const EMPTY_EMAIL_TARGET_DRAFT: EmailTargetDraft = {
  name: '',
  emailsText: '',
  subjectTemplate: '',
  bodyTemplate: '',
  enabled: true,
}

const EMPTY_MAIL_SERVER_DRAFT: MailServerDraft = {
  enabled: false,
  host: '',
  port: '587',
  username: '',
  password: '',
  clearSavedPassword: false,
  from: '',
  requireTls: true,
  skipVerify: false,
}

function parseMappingText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, line) => {
      const separatorIndex = line.indexOf('=')
      if (separatorIndex <= 0) {
        return accumulator
      }
      const key = line.slice(0, separatorIndex).trim()
      const value = line.slice(separatorIndex + 1).trim()
      if (!key || !value) {
        return accumulator
      }
      accumulator[key] = value
      return accumulator
    }, {})
}

function formatMappingText(input?: Record<string, string> | null) {
  return Object.entries(input ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function parseEmailsText(text: string) {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildSubscriptionDraft(subscription: NotificationSubscription): SubscriptionDraft {
  const inAppChannel = subscription.channels?.find((channel) => channel.channel === 'in_app')
  const botChannel = subscription.channels?.find((channel) => channel.channel === 'bot')
  const emailChannel = subscription.channels?.find((channel) => channel.channel === 'email')

  return {
    id: subscription.id,
    topic: subscription.topic,
    filterText: formatMappingText(subscription.filter ?? undefined),
    enabled: subscription.enabled,
    inAppEnabled: Boolean(inAppChannel),
    inAppTitleTemplate: inAppChannel?.titleTemplate ?? '',
    inAppBodyTemplate: inAppChannel?.bodyTemplate ?? '',
    botEnabled: Boolean(botChannel),
    botTargetId: botChannel?.targetRefId ?? '',
    botTitleTemplate: botChannel?.titleTemplate ?? '',
    botBodyTemplate: botChannel?.bodyTemplate ?? '',
    emailEnabled: Boolean(emailChannel),
    emailTargetId: emailChannel?.targetRefId ?? '',
    emailTitleTemplate: emailChannel?.titleTemplate ?? '',
    emailBodyTemplate: emailChannel?.bodyTemplate ?? '',
  }
}

function buildMailServerDraft(config?: NotificationMailServerConfig | null): MailServerDraft {
  if (!config) {
    return EMPTY_MAIL_SERVER_DRAFT
  }

  return {
    enabled: config.enabled,
    host: config.host ?? '',
    port: String(config.port || 587),
    username: config.username ?? '',
    password: '',
    clearSavedPassword: false,
    from: config.from ?? '',
    requireTls: config.requireTls,
    skipVerify: config.skipVerify,
  }
}

function formatTopicLabel(topic: string) {
  switch (topic) {
    case 'hook.blocked':
      return i18n._({ id: 'Hook blocked', message: 'Hook blocked' })
    case 'hook.failed':
      return i18n._({ id: 'Hook failed', message: 'Hook failed' })
    case 'hook.continue_turn':
      return i18n._({ id: 'Hook continue turn', message: 'Hook continue turn' })
    case 'turn.started':
      return i18n._({ id: 'Turn started', message: 'Turn started' })
    case 'turn.completed':
      return i18n._({ id: 'Turn completed', message: 'Turn completed' })
    case 'turn.failed':
      return i18n._({ id: 'Turn failed', message: 'Turn failed' })
    case 'turn.interrupted':
      return i18n._({ id: 'Turn interrupted', message: 'Turn interrupted' })
    case 'turn.cancelled':
      return i18n._({ id: 'Turn cancelled', message: 'Turn cancelled' })
    case 'automation.completed':
      return i18n._({ id: 'Automation completed', message: 'Automation completed' })
    case 'automation.skipped':
      return i18n._({ id: 'Automation skipped', message: 'Automation skipped' })
    case 'automation.failed':
      return i18n._({ id: 'Automation failed', message: 'Automation failed' })
    case 'turn_policy.failed_action':
      return i18n._({ id: 'Turn policy failed action', message: 'Turn policy failed action' })
    case 'bot.delivery.failed':
      return i18n._({ id: 'Bot delivery failed', message: 'Bot delivery failed' })
    case 'system.notification.created':
      return i18n._({ id: 'Legacy notification created', message: 'Legacy notification created' })
    default:
      return humanizeDisplayValue(topic)
  }
}

function formatTopicDescription(topic: string) {
  switch (topic) {
    case 'hook.blocked':
      return i18n._({
        id: 'Hook completed with a block decision.',
        message: 'Hook completed with a block decision.',
      })
    case 'hook.failed':
      return i18n._({
        id: 'Hook execution failed and needs attention.',
        message: 'Hook execution failed and needs attention.',
      })
    case 'hook.continue_turn':
      return i18n._({
        id: 'Hook requested a continue-turn action.',
        message: 'Hook requested a continue-turn action.',
      })
    case 'turn.started':
      return i18n._({
        id: 'A turn started and entered the active lifecycle.',
        message: 'A turn started and entered the active lifecycle.',
      })
    case 'turn.completed':
      return i18n._({
        id: 'A turn finished and can trigger downstream notification delivery.',
        message: 'A turn finished and can trigger downstream notification delivery.',
      })
    case 'turn.failed':
      return i18n._({
        id: 'A turn finished with a failure state.',
        message: 'A turn finished with a failure state.',
      })
    case 'turn.interrupted':
      return i18n._({
        id: 'A turn was interrupted before normal completion.',
        message: 'A turn was interrupted before normal completion.',
      })
    case 'turn.cancelled':
      return i18n._({
        id: 'A turn was cancelled before execution completed.',
        message: 'A turn was cancelled before execution completed.',
      })
    case 'automation.completed':
      return i18n._({
        id: 'Automation run finished successfully.',
        message: 'Automation run finished successfully.',
      })
    case 'automation.skipped':
      return i18n._({
        id: 'Automation run was skipped before execution.',
        message: 'Automation run was skipped before execution.',
      })
    case 'automation.failed':
      return i18n._({
        id: 'Automation run finished with an error.',
        message: 'Automation run finished with an error.',
      })
    case 'turn_policy.failed_action':
      return i18n._({
        id: 'Turn policy remediation failed or requires review.',
        message: 'Turn policy remediation failed or requires review.',
      })
    case 'bot.delivery.failed':
      return i18n._({
        id: 'Bot outbound delivery failed and may need retry.',
        message: 'Bot outbound delivery failed and may need retry.',
      })
    case 'system.notification.created':
      return i18n._({
        id: 'Compatibility topic for legacy notification-based triggers.',
        message: 'Compatibility topic for legacy notification-based triggers.',
      })
    default:
      return humanizeDisplayValue(topic)
  }
}

function formatChannelLabel(channel: string) {
  switch (channel) {
    case 'in_app':
      return i18n._({ id: 'In-app', message: 'In-app' })
    case 'bot':
      return i18n._({ id: 'Delivery target channel', message: 'Delivery target channel' })
    case 'email':
      return i18n._({ id: 'Email', message: 'Email' })
    default:
      return humanizeDisplayValue(channel)
  }
}

function formatTargetTypeLabel(targetRefType: string) {
  switch (targetRefType) {
    case 'workspace':
      return i18n._({ id: 'Workspace inbox', message: 'Workspace inbox' })
    case 'bot_delivery_target':
      return i18n._({ id: 'Delivery target', message: 'Delivery target' })
    case 'email_target':
      return i18n._({ id: 'Email target group', message: 'Email target group' })
    default:
      return humanizeDisplayValue(targetRefType)
  }
}

function renderEmbeddedTemplateVariables(topic: string) {
  const commonValues = {
    title: '{{title}}',
    message: '{{message}}',
    threadId: '{{threadId}}',
    turnId: '{{turnId}}',
    topic: '{{topic}}',
    level: '{{level}}',
  }
  const turnCompletedValues = {
    lastAgentMessage: '{{lastAgentMessage}}',
    lastAgentMessagePreview: '{{lastAgentMessagePreview}}',
    lastTurnText: '{{lastTurnText}}',
    lastTurnTextPreview: '{{lastTurnTextPreview}}',
  }

  return (
    <div className="notification-center-inline-tooltip" role="note">
      <div className="notification-center-inline-tooltip__header">
        <strong>{i18n._({ id: 'Template variables', message: 'Template variables' })}</strong>
      </div>
      <div className="notification-center-inline-tooltip__body">
        {i18n._({
          id: 'notificationCenter.templateVariables.common',
          message: 'Use {title}, {message}, {threadId}, {turnId}, {topic}, and {level}.',
          values: commonValues,
        })}
      </div>
      {topic === 'turn.completed' ? (
        <div className="notification-center-inline-tooltip__body">
          {i18n._({
            id: 'notificationCenter.templateVariables.turnCompleted',
            message:
              'For turn.completed, you can also use {lastAgentMessage}, {lastAgentMessagePreview}, {lastTurnText}, and {lastTurnTextPreview}.',
            values: turnCompletedValues,
          })}
        </div>
      ) : null}
    </div>
  )
}

export function NotificationCenterPage() {
  const queryClient = useQueryClient()
  const sessionSelectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId)
  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [subscriptionDraft, setSubscriptionDraft] = useState<SubscriptionDraft>(EMPTY_SUBSCRIPTION_DRAFT)
  const [emailTargetDraft, setEmailTargetDraft] = useState<EmailTargetDraft>(EMPTY_EMAIL_TARGET_DRAFT)
  const [mailServerDraft, setMailServerDraft] = useState<MailServerDraft>(EMPTY_MAIL_SERVER_DRAFT)
  const [dispatchFilters, setDispatchFilters] = useState<DispatchFilterState>({
    topic: '',
    channel: '',
    status: '',
  })
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false)
  const [showMailServerDialog, setShowMailServerDialog] = useState(false)
  const [showEmailTargetDialog, setShowEmailTargetDialog] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState('')
  const [emailTargetError, setEmailTargetError] = useState('')
  const [mailServerError, setMailServerError] = useState('')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  useEffect(() => {
    const workspaces = workspacesQuery.data ?? []
    if (!workspaces.length) {
      setSelectedWorkspaceId('')
      return
    }

    if (selectedWorkspaceId && workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return
    }

    if (
      sessionSelectedWorkspaceId &&
      workspaces.some((workspace) => workspace.id === sessionSelectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(sessionSelectedWorkspaceId)
      return
    }

    setSelectedWorkspaceId(workspaces[0].id)
  }, [selectedWorkspaceId, sessionSelectedWorkspaceId, workspacesQuery.data])

  useEffect(() => {
    if (selectedWorkspaceId) {
      setSelectedWorkspace(selectedWorkspaceId)
    }
  }, [selectedWorkspaceId, setSelectedWorkspace])

  const workspaceId = selectedWorkspaceId || workspacesQuery.data?.[0]?.id || ''
  const selectedWorkspace = useMemo(
    () => (workspacesQuery.data ?? []).find((workspace) => workspace.id === workspaceId),
    [workspaceId, workspacesQuery.data],
  )
  const workspaceNameById = useMemo(
    () => new Map((workspacesQuery.data ?? []).map((workspace) => [workspace.id, workspace.name])),
    [workspacesQuery.data],
  )

  const botsQuery = useQuery({
    queryKey: ['available-bots', workspaceId],
    queryFn: () => listAvailableBots(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const availableBotTargetsQuery = useQuery({
    queryKey: ['available-bot-delivery-targets', workspaceId],
    queryFn: () => listAvailableBotDeliveryTargets(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const allDeliveryTargets = useMemo<DeliveryTargetOption[]>(() => {
    const botNameByID = new Map((botsQuery.data ?? []).map((bot) => [bot.id, bot.name]))
    return (availableBotTargetsQuery.data ?? []).map((target) => ({
      ...target,
      botName: botNameByID.get(target.botId) ?? target.botId,
    }))
  }, [availableBotTargetsQuery.data, botsQuery.data])

  const deliveryTargets = useMemo<DeliveryTargetOption[]>(
    () => allDeliveryTargets.filter((target) => isDeliveryTargetReady(target)),
    [allDeliveryTargets],
  )

  const unavailableDeliveryTargetCount = allDeliveryTargets.length - deliveryTargets.length

  const subscriptionsQuery = useQuery({
    queryKey: ['notification-subscriptions', workspaceId],
    queryFn: () => listNotificationSubscriptions(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const mailServerQuery = useQuery({
    queryKey: ['notification-mail-server', workspaceId],
    queryFn: () => getNotificationMailServerConfig(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const emailTargetsQuery = useQuery({
    queryKey: ['notification-email-targets', workspaceId],
    queryFn: () => listNotificationEmailTargets(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const dispatchesQuery = useQuery({
    queryKey: ['notification-dispatches', workspaceId, dispatchFilters],
    queryFn: () => listNotificationDispatches(workspaceId, dispatchFilters),
    enabled: Boolean(workspaceId),
  })

  useEffect(() => {
    setMailServerDraft(buildMailServerDraft(mailServerQuery.data))
    setMailServerError('')
  }, [mailServerQuery.data?.updatedAt, mailServerQuery.data?.workspaceId])

  useEffect(() => {
    if (!showSubscriptionDialog || !subscriptionDraft.botEnabled) {
      return
    }

    if (!subscriptionDraft.botTargetId.trim()) {
      return
    }

    if (deliveryTargets.some((target) => target.id === subscriptionDraft.botTargetId.trim())) {
      return
    }

    setSubscriptionDraft((current) => ({
      ...current,
      botTargetId: '',
    }))
  }, [deliveryTargets, showSubscriptionDialog, subscriptionDraft.botEnabled, subscriptionDraft.botTargetId])

  const botTargetSubscriptionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const subscription of subscriptionsQuery.data ?? []) {
      for (const channel of subscription.channels ?? []) {
        if (channel.channel !== 'bot' || !channel.targetRefId) {
          continue
        }
        counts.set(channel.targetRefId, (counts.get(channel.targetRefId) ?? 0) + 1)
      }
    }
    return counts
  }, [subscriptionsQuery.data])

  const emailTargetSubscriptionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const subscription of subscriptionsQuery.data ?? []) {
      for (const channel of subscription.channels ?? []) {
        if (channel.channel !== 'email' || !channel.targetRefId) {
          continue
        }
        counts.set(channel.targetRefId, (counts.get(channel.targetRefId) ?? 0) + 1)
      }
    }
    return counts
  }, [subscriptionsQuery.data])

  const saveSubscriptionMutation = useMutation({
    mutationFn: async (draft: SubscriptionDraft) => {
      const topicDefinition = getNotificationTopicDefinition(draft.topic)
      const channels = []

      if (draft.inAppEnabled) {
        channels.push({
          channel: 'in_app',
          targetRefType: 'workspace',
          targetRefId: workspaceId,
          titleTemplate: draft.inAppTitleTemplate.trim(),
          bodyTemplate: draft.inAppBodyTemplate.trim(),
        })
      }

      if (draft.botEnabled) {
        channels.push({
          channel: 'bot',
          targetRefType: 'bot_delivery_target',
          targetRefId: draft.botTargetId.trim(),
          titleTemplate: draft.botTitleTemplate.trim(),
          bodyTemplate: draft.botBodyTemplate.trim(),
        })
      }

      if (draft.emailEnabled) {
        channels.push({
          channel: 'email',
          targetRefType: 'email_target',
          targetRefId: draft.emailTargetId.trim(),
          titleTemplate: draft.emailTitleTemplate.trim(),
          bodyTemplate: draft.emailBodyTemplate.trim(),
        })
      }

      if (!channels.length) {
        throw new Error(
          i18n._({
            id: 'Choose at least one notification channel.',
            message: 'Choose at least one notification channel.',
          }),
        )
      }

        if (draft.botEnabled && !draft.botTargetId.trim()) {
          throw new Error(
            i18n._({
              id: 'Choose an available delivery target before saving this delivery target channel.',
              message: 'Choose an available delivery target before saving this delivery target channel.',
            }),
          )
        }

        if (
          draft.botEnabled &&
          !deliveryTargets.some((target) => target.id === draft.botTargetId.trim())
        ) {
          throw new Error(
            i18n._({
              id: 'The selected target is not currently available for Notification Center. Choose a ready delivery target instead.',
              message:
                'The selected target is not currently available for Notification Center. Choose a ready delivery target instead.',
            }),
          )
        }

      if (draft.emailEnabled && !draft.emailTargetId.trim()) {
        throw new Error(
          i18n._({
            id: 'Choose an email target group before saving an email channel.',
            message: 'Choose an email target group before saving an email channel.',
          }),
        )
      }

      const payload = {
        topic: draft.topic,
        sourceType: topicDefinition?.sourceType ?? '',
        filter: parseMappingText(draft.filterText),
        enabled: draft.enabled,
        channels,
      }

      if (draft.id) {
        return updateNotificationSubscription(workspaceId, draft.id, payload)
      }
      return createNotificationSubscription(workspaceId, payload)
    },
    onSuccess: async () => {
      setSubscriptionError('')
      setSubscriptionDraft(EMPTY_SUBSCRIPTION_DRAFT)
      setShowSubscriptionDialog(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-subscriptions', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['notification-dispatches', workspaceId] }),
      ])
    },
    onError: (error) => {
      setSubscriptionError(getErrorMessage(error))
    },
  })

  const deleteSubscriptionMutation = useMutation({
    mutationFn: (subscriptionId: string) => deleteNotificationSubscription(workspaceId, subscriptionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notification-subscriptions', workspaceId] })
    },
  })

  const createEmailTargetMutation = useMutation({
    mutationFn: () =>
      createNotificationEmailTarget(workspaceId, {
        name: emailTargetDraft.name.trim(),
        emails: parseEmailsText(emailTargetDraft.emailsText),
        subjectTemplate: emailTargetDraft.subjectTemplate.trim(),
        bodyTemplate: emailTargetDraft.bodyTemplate.trim(),
        enabled: emailTargetDraft.enabled,
      }),
    onSuccess: async () => {
      setEmailTargetError('')
      setEmailTargetDraft(EMPTY_EMAIL_TARGET_DRAFT)
      setShowEmailTargetDialog(false)
      await queryClient.invalidateQueries({ queryKey: ['notification-email-targets', workspaceId] })
    },
    onError: (error) => {
      setEmailTargetError(getErrorMessage(error))
    },
  })

  const saveMailServerMutation = useMutation({
    mutationFn: () => {
      const parsedPort = Number.parseInt(mailServerDraft.port, 10)
      return upsertNotificationMailServerConfig(workspaceId, {
        enabled: mailServerDraft.enabled,
        host: mailServerDraft.host.trim(),
        port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 0,
        username: mailServerDraft.username.trim(),
        password: mailServerDraft.password,
        clearPassword: mailServerDraft.clearSavedPassword && !mailServerDraft.password,
        from: mailServerDraft.from.trim(),
        requireTls: mailServerDraft.requireTls,
        skipVerify: mailServerDraft.skipVerify,
      })
    },
    onSuccess: async (config) => {
      setMailServerError('')
      setMailServerDraft(buildMailServerDraft(config))
      setShowMailServerDialog(false)
      await queryClient.invalidateQueries({ queryKey: ['notification-mail-server', workspaceId] })
    },
    onError: (error) => {
      setMailServerError(getErrorMessage(error))
    },
  })

  const retryDispatchMutation = useMutation({
    mutationFn: (dispatchId: string) => retryNotificationDispatch(workspaceId, dispatchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notification-dispatches', workspaceId] })
    },
  })

  const selectedTopicDefinition = getNotificationTopicDefinition(subscriptionDraft.topic)
  const selectedBotTarget = deliveryTargets.find((target) => target.id === subscriptionDraft.botTargetId)
  const configuredBotTarget = allDeliveryTargets.find((target) => target.id === subscriptionDraft.botTargetId)
  const selectedUnavailableBotTarget =
    configuredBotTarget && !selectedBotTarget ? configuredBotTarget : null
  const selectedEmailTarget = (emailTargetsQuery.data ?? []).find(
    (target) => target.id === subscriptionDraft.emailTargetId,
  )
  const pageError =
    workspacesQuery.error ??
    subscriptionsQuery.error ??
    mailServerQuery.error ??
    emailTargetsQuery.error ??
    dispatchesQuery.error ??
    botsQuery.error ??
    availableBotTargetsQuery.error

  const workspaceMailServerEnabled = Boolean(mailServerQuery.data?.enabled)
  const workspaceMailServerConfigured = Boolean(
    mailServerQuery.data?.enabled && mailServerQuery.data?.host && mailServerQuery.data?.from,
  )
  const workspaceMailServerLabel = workspaceMailServerConfigured
    ? i18n._({
        id: 'Workspace mail server configured',
        message: 'Workspace mail server configured',
      })
    : workspaceMailServerEnabled
      ? i18n._({
          id: 'Workspace mail server needs host and from address',
          message: 'Workspace mail server needs host and from address',
        })
      : i18n._({
          id: 'No workspace mail server override',
          message: 'No workspace mail server override',
        })

  function handleSubscriptionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubscriptionError('')
    void saveSubscriptionMutation.mutate(subscriptionDraft)
  }

  function handleEmailTargetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailTargetError('')
    if (!parseEmailsText(emailTargetDraft.emailsText).length) {
      setEmailTargetError(
        i18n._({
          id: 'Enter at least one email address.',
          message: 'Enter at least one email address.',
        }),
      )
      return
    }
    void createEmailTargetMutation.mutate()
  }

  function handleMailServerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMailServerError('')

    const parsedPort = Number.parseInt(mailServerDraft.port, 10)
    if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
      setMailServerError(
        i18n._({
          id: 'Enter a valid SMTP port.',
          message: 'Enter a valid SMTP port.',
        }),
      )
      return
    }

    if (mailServerDraft.enabled && (!mailServerDraft.host.trim() || !mailServerDraft.from.trim())) {
      setMailServerError(
        i18n._({
          id: 'Host and from address are required when the workspace mail server is enabled.',
          message: 'Host and from address are required when the workspace mail server is enabled.',
        }),
      )
      return
    }

    void saveMailServerMutation.mutate()
  }

  return (
    <section className="screen">
      <div className="stack-screen notification-center-page">
        <PageHeader
          eyebrow={i18n._({ id: 'Notification Center', message: 'Notification Center' })}
          title={i18n._({
            id: 'Hook, delivery target, email, and inbox orchestration',
            message: 'Hook, delivery target, email, and inbox orchestration',
          })}
          description={i18n._({
            id: 'Configure event subscriptions once, then route them to inbox, delivery targets, or email target groups.',
            message:
              'Configure event subscriptions once, then route them to inbox, delivery targets, or email target groups.',
          })}
          meta={
            <div className="page-header__meta">
              <span>
                {i18n._({ id: 'Subscriptions', message: 'Subscriptions' })}:{' '}
                {formatLocaleNumber((subscriptionsQuery.data ?? []).length)}
              </span>
              <span>
                {i18n._({ id: 'Email targets', message: 'Email targets' })}:{' '}
                {formatLocaleNumber((emailTargetsQuery.data ?? []).length)}
              </span>
              <span>
                {i18n._({ id: 'Dispatch records', message: 'Dispatch records' })}:{' '}
                {formatLocaleNumber((dispatchesQuery.data ?? []).length)}
              </span>
            </div>
          }
        />

        {pageError ? (
          <InlineNotice
            title={i18n._({
              id: 'Notification center data is unavailable',
              message: 'Notification center data is unavailable',
            })}
            tone="error"
          >
            {getErrorMessage(pageError)}
          </InlineNotice>
        ) : null}

        <section className="notification-center-panel">
          <div className="notification-center-panel__header">
            <div>
              <h2>{i18n._({ id: 'Workspace scope', message: 'Workspace scope' })}</h2>
              <p>
                {i18n._({
                  id: 'Select a workspace, review current capacity, then configure mail, targets, rules, and audit in related groups.',
                  message:
                    'Select a workspace, review current capacity, then configure mail, targets, rules, and audit in related groups.',
                })}
              </p>
            </div>
          </div>

          <div className="notification-center-grid notification-center-grid--compact">
            <Select
              label={i18n._({ id: 'Workspace', message: 'Workspace' })}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              value={workspaceId}
            >
              {(workspacesQuery.data ?? []).map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>

            <div className="notification-center-fact-card">
              <span className="notification-center-fact-card__label">
                {i18n._({ id: 'Workspace inbox', message: 'Workspace inbox' })}
              </span>
              <strong>
                {selectedWorkspace?.name ?? i18n._({ id: 'No workspace', message: 'No workspace' })}
              </strong>
              <small>
                {i18n._({
                  id: 'In-app notifications are written into the selected workspace inbox.',
                  message: 'In-app notifications are written into the selected workspace inbox.',
                })}
              </small>
            </div>

            <div className="notification-center-fact-card">
              <span className="notification-center-fact-card__label">
                {i18n._({ id: 'Subscriptions', message: 'Subscriptions' })}
              </span>
              <strong>{formatLocaleNumber((subscriptionsQuery.data ?? []).length)}</strong>
              <small>
                {i18n._({
                  id: 'Rules link normalized topics to in-app, delivery target, and email channels.',
                  message: 'Rules link normalized topics to in-app, delivery target, and email channels.',
                })}
              </small>
            </div>

            <div className="notification-center-fact-card">
              <span className="notification-center-fact-card__label">
                {i18n._({ id: 'Mail server', message: 'Mail server' })}
              </span>
              <strong>{workspaceMailServerLabel}</strong>
              <small>
                {i18n._({
                  id: 'If the workspace mail server is disabled, email delivery falls back to the server environment when available.',
                  message:
                    'If the workspace mail server is disabled, email delivery falls back to the server environment when available.',
                })}
              </small>
            </div>

            <div className="notification-center-fact-card">
              <span className="notification-center-fact-card__label">
                {i18n._({ id: 'Provider routing', message: 'Provider routing' })}
              </span>
              <strong>
                {i18n._({
                  id: 'Telegram and WeChat stay under delivery targets.',
                  message: 'Telegram and WeChat stay under delivery targets.',
                })}
              </strong>
              <small>
                {i18n._({
                  id: 'Notification Center binds to delivery targets. Provider setup and recipient readiness still belong to the Bots page.',
                  message:
                    'Notification Center binds to delivery targets. Provider setup and recipient readiness still belong to the Bots page.',
                })}
              </small>
            </div>
          </div>
        </section>

        <section className="notification-center-panel">
          <div className="notification-center-panel__header">
            <div>
              <h2>{i18n._({ id: 'Channels and infrastructure', message: 'Channels and infrastructure' })}</h2>
              <p>
                {i18n._({
                  id: 'Configure workspace mail transport first, then maintain reusable delivery targets and email target groups.',
                  message:
                    'Configure workspace mail transport first, then maintain reusable delivery targets and email target groups.',
                })}
              </p>
            </div>
          </div>

          <div className="notification-center-grid">
            <section className="notification-center-subsection">
              <div className="notification-center-panel__header">
                <div>
                  <h3>{i18n._({ id: 'Mail server', message: 'Mail server' })}</h3>
                  <p>
                    {i18n._({
                      id: 'Workspace-specific SMTP settings for the email channel.',
                      message: 'Workspace-specific SMTP settings for the email channel.',
                    })}
                  </p>
                </div>
                <Button
                  intent="secondary"
                  size="sm"
                  onClick={() => {
                    setMailServerDraft(buildMailServerDraft(mailServerQuery.data))
                    setMailServerError('')
                    setShowMailServerDialog(true)
                  }}
                >
                  {i18n._({ id: 'Configure mail server', message: 'Configure mail server' })}
                </Button>
              </div>

              <div className="notification-center-grid notification-center-grid--compact">
                <div className="notification-center-fact-card">
                  <span className="notification-center-fact-card__label">
                    {i18n._({ id: 'Mode', message: 'Mode' })}
                  </span>
                  <strong>{workspaceMailServerLabel}</strong>
                  <small>
                    {mailServerQuery.data?.updatedAt
                      ? formatLocalizedDateTime(mailServerQuery.data.updatedAt)
                      : i18n._({ id: 'Not saved yet', message: 'Not saved yet' })}
                  </small>
                </div>
                <div className="notification-center-fact-card">
                  <span className="notification-center-fact-card__label">
                    {i18n._({ id: 'Current endpoint', message: 'Current endpoint' })}
                  </span>
                  <strong>
                    {mailServerQuery.data?.host
                      ? `${mailServerQuery.data.host}:${mailServerQuery.data.port}`
                      : i18n._({ id: 'No host configured', message: 'No host configured' })}
                  </strong>
                  <small>
                    {mailServerQuery.data?.from ||
                      i18n._({
                        id: 'Set the sender address used for all workspace email deliveries.',
                        message: 'Set the sender address used for all workspace email deliveries.',
                      })}
                  </small>
                </div>
              </div>

              {showMailServerDialog ? (
                <Modal
                  title={i18n._({ id: 'Mail server', message: 'Mail server' })}
                  footer={
                    <div className="notification-center-actions">
                      <Button isLoading={saveMailServerMutation.isPending} type="submit" form="mail-server-form">
                        {i18n._({ id: 'Save mail server', message: 'Save mail server' })}
                      </Button>
                      <Button
                        intent="ghost"
                        onClick={() => {
                          setShowMailServerDialog(false)
                          setMailServerError('')
                          setMailServerDraft(buildMailServerDraft(mailServerQuery.data))
                        }}
                        type="button"
                      >
                        {i18n._({ id: 'Cancel', message: 'Cancel' })}
                      </Button>
                    </div>
                  }
                  onClose={() => {
                    setShowMailServerDialog(false)
                    setMailServerError('')
                    setMailServerDraft(buildMailServerDraft(mailServerQuery.data))
                  }}
                >
                  {mailServerError ? (
                    <InlineNotice
                      title={i18n._({
                        id: 'Mail server configuration could not be saved',
                        message: 'Mail server configuration could not be saved',
                      })}
                      tone="error"
                    >
                      {mailServerError}
                    </InlineNotice>
                  ) : null}

                  {mailServerQuery.data?.passwordSet ? (
                    <InlineNotice
                      title={i18n._({
                        id: 'A password is already stored for this workspace mail server.',
                        message: 'A password is already stored for this workspace mail server.',
                      })}
                      tone="info"
                    >
                      {i18n._({
                        id: 'Leave the password field empty to keep the saved secret, or enter a new value to replace it.',
                        message:
                          'Leave the password field empty to keep the saved secret, or enter a new value to replace it.',
                      })}
                    </InlineNotice>
                  ) : null}

                  <form id="mail-server-form" className="notification-center-form" onSubmit={handleMailServerSubmit}>
                    <Switch
                      checked={mailServerDraft.enabled}
                      hint={i18n._({
                        id: 'When disabled, the backend uses environment SMTP settings if available.',
                        message: 'When disabled, the backend uses environment SMTP settings if available.',
                      })}
                      label={i18n._({
                        id: 'Use workspace mail server',
                        message: 'Use workspace mail server',
                      })}
                      onChange={(event) =>
                        setMailServerDraft((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />

                    <div className="notification-center-grid notification-center-grid--compact">
                      <Input
                        label={i18n._({ id: 'SMTP host', message: 'SMTP host' })}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            host: event.target.value,
                          }))
                        }
                        placeholder="smtp.example.com"
                        value={mailServerDraft.host}
                      />
                      <Input
                        label={i18n._({ id: 'Port', message: 'Port' })}
                        min={1}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            port: event.target.value,
                          }))
                        }
                        type="number"
                        value={mailServerDraft.port}
                      />
                      <Input
                        label={i18n._({ id: 'Username', message: 'Username' })}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                        value={mailServerDraft.username}
                      />
                      <Input
                        hint={
                          mailServerQuery.data?.passwordSet
                            ? i18n._({
                                id: 'Leave blank to keep the saved password.',
                                message: 'Leave blank to keep the saved password.',
                              })
                            : undefined
                        }
                        label={i18n._({ id: 'Password', message: 'Password' })}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            password: event.target.value,
                            clearSavedPassword: false,
                          }))
                        }
                        type="password"
                        value={mailServerDraft.password}
                      />
                    </div>

                    <Input
                      label={i18n._({ id: 'From address', message: 'From address' })}
                      onChange={(event) =>
                        setMailServerDraft((current) => ({
                          ...current,
                          from: event.target.value,
                        }))
                      }
                      placeholder={i18n._({
                        id: 'alerts@example.com',
                        message: 'alerts@example.com',
                      })}
                      value={mailServerDraft.from}
                    />

                    <div className="notification-center-grid notification-center-grid--compact">
                      <Switch
                        checked={mailServerDraft.requireTls}
                        label={i18n._({ id: 'Require TLS', message: 'Require TLS' })}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            requireTls: event.target.checked,
                          }))
                        }
                      />
                      <Switch
                        checked={mailServerDraft.skipVerify}
                        label={i18n._({
                          id: 'Skip certificate verification',
                          message: 'Skip certificate verification',
                        })}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            skipVerify: event.target.checked,
                          }))
                        }
                      />
                      <Switch
                        checked={mailServerDraft.clearSavedPassword}
                        disabled={!mailServerQuery.data?.passwordSet}
                        label={i18n._({
                          id: 'Clear saved password',
                          message: 'Clear saved password',
                        })}
                        onChange={(event) =>
                          setMailServerDraft((current) => ({
                            ...current,
                            clearSavedPassword: event.target.checked,
                            password: event.target.checked ? '' : current.password,
                          }))
                        }
                      />
                    </div>

                  </form>
                </Modal>
              ) : null}
            </section>

            <section className="notification-center-subsection">
              <div className="notification-center-panel__header">
                <div>
                  <h3>{i18n._({ id: 'Email target group', message: 'Email target group' })}</h3>
                  <p>
                    {i18n._({
                      id: 'Reusable recipient groups for the email channel.',
                      message: 'Reusable recipient groups for the email channel.',
                    })}
                  </p>
                </div>
                <Button
                  intent="secondary"
                  size="sm"
                  onClick={() => {
                    setEmailTargetDraft(EMPTY_EMAIL_TARGET_DRAFT)
                    setEmailTargetError('')
                    setShowEmailTargetDialog(true)
                  }}
                >
                  {i18n._({ id: 'Add email target', message: 'Add email target' })}
                </Button>
              </div>

              {showEmailTargetDialog ? (
                <Modal
                  title={i18n._({ id: 'Email target group', message: 'Email target group' })}
                  footer={
                    <div className="notification-center-actions">
                      <Button isLoading={createEmailTargetMutation.isPending} type="submit" form="email-target-form">
                        {i18n._({ id: 'Create email target', message: 'Create email target' })}
                      </Button>
                      <Button
                        intent="ghost"
                        onClick={() => {
                          setShowEmailTargetDialog(false)
                          setEmailTargetError('')
                          setEmailTargetDraft(EMPTY_EMAIL_TARGET_DRAFT)
                        }}
                        type="button"
                      >
                        {i18n._({ id: 'Cancel', message: 'Cancel' })}
                      </Button>
                    </div>
                  }
                  onClose={() => {
                    setShowEmailTargetDialog(false)
                    setEmailTargetError('')
                    setEmailTargetDraft(EMPTY_EMAIL_TARGET_DRAFT)
                  }}
                >
                  {emailTargetError ? (
                    <InlineNotice
                      title={i18n._({
                        id: 'Email target could not be created',
                        message: 'Email target could not be created',
                      })}
                      tone="error"
                    >
                      {emailTargetError}
                    </InlineNotice>
                  ) : null}

                  <form id="email-target-form" className="notification-center-form" onSubmit={handleEmailTargetSubmit}>
                    <Input
                      label={i18n._({ id: 'Name', message: 'Name' })}
                      onChange={(event) =>
                        setEmailTargetDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      value={emailTargetDraft.name}
                    />
                    <TextArea
                      hint={i18n._({
                        id: 'One email per line or comma-separated.',
                        message: 'One email per line or comma-separated.',
                      })}
                      label={i18n._({ id: 'Recipients', message: 'Recipients' })}
                      onChange={(event) =>
                        setEmailTargetDraft((current) => ({
                          ...current,
                          emailsText: event.target.value,
                        }))
                      }
                      rows={4}
                      value={emailTargetDraft.emailsText}
                    />
                    <Input
                      label={i18n._({
                        id: 'Default subject template',
                        message: 'Default subject template',
                      })}
                      onChange={(event) =>
                        setEmailTargetDraft((current) => ({
                          ...current,
                          subjectTemplate: event.target.value,
                        }))
                      }
                      value={emailTargetDraft.subjectTemplate}
                    />
                    <TextArea
                      label={i18n._({ id: 'Default body template', message: 'Default body template' })}
                      onChange={(event) =>
                        setEmailTargetDraft((current) => ({
                          ...current,
                          bodyTemplate: event.target.value,
                        }))
                      }
                      rows={4}
                      value={emailTargetDraft.bodyTemplate}
                    />
                    <Switch
                      checked={emailTargetDraft.enabled}
                      label={i18n._({ id: 'Enabled', message: 'Enabled' })}
                      onChange={(event) =>
                        setEmailTargetDraft((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                  </form>
                </Modal>
              ) : null}
            </section>
          </div>

          <div className="notification-center-grid">
            <section className="notification-center-subsection">
              <div className="notification-center-panel__header">
                <div>
                  <h3>{i18n._({ id: 'Delivery targets', message: 'Delivery targets' })}</h3>
                  <p>
                    {i18n._({
                      id: 'Notification Center uses these targets for message delivery across all workspaces. Provider details stay on the Bots page.',
                      message:
                        'Notification Center uses these targets for message delivery across all workspaces. Provider details stay on the Bots page.',
                    })}{' '}
                    <Link to="/bots">
                      {i18n._({
                        id: 'Open Bots page',
                        message: 'Open Bots page',
                      })}
                    </Link>
                  </p>
                </div>
              </div>
              <div className="notification-center-table-wrap">
                <table className="notification-center-table">
                  <thead>
                    <tr>
                      <th>{i18n._({ id: 'Workspace', message: 'Workspace' })}</th>
                      <th>{i18n._({ id: 'Owning bot', message: 'Owning bot' })}</th>
                      <th>{i18n._({ id: 'Provider', message: 'Provider' })}</th>
                      <th>{i18n._({ id: 'Target', message: 'Target' })}</th>
                      <th>{i18n._({ id: 'Readiness', message: 'Readiness' })}</th>
                      <th>{i18n._({ id: 'Subscriptions', message: 'Subscriptions' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                  {deliveryTargets.length ? (
                    deliveryTargets.map((target) => (
                      <tr key={target.id}>
                        <td>
                          {workspaceNameById.get(target.workspaceId ?? '') ||
                            target.workspaceId ||
                            i18n._({ id: 'Unknown workspace', message: 'Unknown workspace' })}
                        </td>
                        <td>{target.botName}</td>
                        <td>{humanizeDisplayValue(target.provider)}</td>
                        <td>{target.title || target.routeKey || target.id}</td>
                        <td>{formatLocalizedStatusLabel(target.deliveryReadiness || target.status)}</td>
                        <td>{formatLocaleNumber(botTargetSubscriptionCounts.get(target.id) ?? 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          {i18n._({
                            id: 'No delivery targets found across the available workspaces.',
                            message: 'No delivery targets found across the available workspaces.',
                          })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="notification-center-subsection">
              <div className="notification-center-panel__header">
                <div>
                  <h3>{i18n._({ id: 'Email target groups', message: 'Email target groups' })}</h3>
                  <p>
                    {i18n._({
                      id: 'These groups are reusable email destinations for the email channel.',
                      message: 'These groups are reusable email destinations for the email channel.',
                    })}
                  </p>
                </div>
              </div>
              <div className="notification-center-table-wrap">
                <table className="notification-center-table">
                  <thead>
                    <tr>
                      <th>{i18n._({ id: 'Name', message: 'Name' })}</th>
                      <th>{i18n._({ id: 'Recipients', message: 'Recipients' })}</th>
                      <th>{i18n._({ id: 'Subscriptions', message: 'Subscriptions' })}</th>
                      <th>{i18n._({ id: 'Status', message: 'Status' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(emailTargetsQuery.data ?? []).length ? (
                      (emailTargetsQuery.data ?? []).map((target) => (
                        <tr key={target.id}>
                          <td>{target.name}</td>
                          <td>{target.emails?.join(', ') || '—'}</td>
                          <td>{formatLocaleNumber(emailTargetSubscriptionCounts.get(target.id) ?? 0)}</td>
                          <td>
                            <StatusPill status={target.enabled ? 'enabled' : 'disabled'} />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>
                          {i18n._({
                            id: 'No email target groups yet.',
                            message: 'No email target groups yet.',
                          })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>

        <section className="notification-center-panel">
          <div className="notification-center-panel__header">
            <div>
              <h2>{i18n._({ id: 'Subscription rules', message: 'Subscription rules' })}</h2>
              <p>
                {i18n._({
                  id: 'Build rules from normalized topics, then bind each rule to inbox, bot, or email delivery.',
                  message:
                    'Build rules from normalized topics, then bind each rule to inbox, bot, or email delivery.',
                })}
              </p>
            </div>
          </div>

          <div className="notification-center-grid">
            <section className="notification-center-subsection">
              <div className="notification-center-panel__header">
                <div>
                  <h3>{i18n._({ id: 'Subscription rule', message: 'Subscription rule' })}</h3>
                  <p>
                    {i18n._({
                      id: 'Topics are normalized events. Channels decide whether the message goes to inbox, bot, or email.',
                      message:
                        'Topics are normalized events. Channels decide whether the message goes to inbox, bot, or email.',
                    })}
                  </p>
                </div>
                <Button
                  disabled={saveSubscriptionMutation.isPending}
                  intent="secondary"
                  size="sm"
                  onClick={() => {
                    if (!subscriptionDraft.id) {
                      setSubscriptionDraft(EMPTY_SUBSCRIPTION_DRAFT)
                    }
                    setSubscriptionError('')
                    saveSubscriptionMutation.reset()
                    setShowSubscriptionDialog(true)
                  }}
                >
                  {subscriptionDraft.id
                    ? i18n._({ id: 'Edit subscription', message: 'Edit subscription' })
                    : i18n._({ id: 'Create subscription', message: 'Create subscription' })}
                </Button>
              </div>

              {showSubscriptionDialog ? (
                <Modal
                  title={
                    subscriptionDraft.id
                      ? i18n._({ id: 'Edit subscription', message: 'Edit subscription' })
                      : i18n._({ id: 'Create subscription', message: 'Create subscription' })
                  }
                  footer={
                    <div className="notification-center-actions">
                      <Button isLoading={saveSubscriptionMutation.isPending} type="submit" form="subscription-form">
                        {subscriptionDraft.id
                          ? i18n._({ id: 'Update subscription', message: 'Update subscription' })
                          : i18n._({ id: 'Create subscription', message: 'Create subscription' })}
                      </Button>
                      <Button
                        intent="ghost"
                        onClick={() => {
                          setShowSubscriptionDialog(false)
                          setSubscriptionError('')
                          setSubscriptionDraft(EMPTY_SUBSCRIPTION_DRAFT)
                          saveSubscriptionMutation.reset()
                        }}
                        type="button"
                      >
                        {i18n._({ id: 'Cancel', message: 'Cancel' })}
                      </Button>
                    </div>
                  }
                  onClose={() => {
                    setShowSubscriptionDialog(false)
                    setSubscriptionError('')
                    setSubscriptionDraft(EMPTY_SUBSCRIPTION_DRAFT)
                    saveSubscriptionMutation.reset()
                  }}
                >
                  {subscriptionError ? (
                    <InlineNotice
                      title={i18n._({
                        id: 'Subscription could not be saved',
                        message: 'Subscription could not be saved',
                      })}
                      tone="error"
                    >
                      {subscriptionError}
                    </InlineNotice>
                  ) : null}

                  <form id="subscription-form" className="notification-center-form" onSubmit={handleSubscriptionSubmit}>
                    <Select
                      label={i18n._({ id: 'Topic', message: 'Topic' })}
                      onChange={(event) =>
                        setSubscriptionDraft((current) => ({
                          ...current,
                          topic: event.target.value,
                        }))
                      }
                      value={subscriptionDraft.topic}
                    >
                      {notificationTopicCatalog.map((topic) => (
                        <option key={topic.topic} value={topic.topic}>
                          {formatTopicLabel(topic.topic)}
                        </option>
                      ))}
                    </Select>

                    <div className="notification-center-grid notification-center-grid--compact">
                      <div className="notification-center-fact-card">
                        <span className="notification-center-fact-card__label">
                          {i18n._({ id: 'Source type', message: 'Source type' })}
                        </span>
                        <strong>{humanizeDisplayValue(selectedTopicDefinition?.sourceType ?? '')}</strong>
                        <small>{formatTopicDescription(subscriptionDraft.topic)}</small>
                      </div>
                      <div className="notification-center-fact-card">
                        <span className="notification-center-fact-card__label">
                          {i18n._({ id: 'Suggested channels', message: 'Suggested channels' })}
                        </span>
                        <strong>
                          {selectedTopicDefinition?.defaultChannels?.length
                            ? selectedTopicDefinition.defaultChannels.map(formatChannelLabel).join(', ')
                            : i18n._({ id: 'None', message: 'None' })}
                        </strong>
                        <small>
                          {i18n._({
                            id: 'You can override these defaults for the current rule.',
                            message: 'You can override these defaults for the current rule.',
                          })}
                        </small>
                      </div>
                    </div>

                    {renderEmbeddedTemplateVariables(subscriptionDraft.topic)}

                    <TextArea
                      hint={i18n._({
                        id: 'Optional filter. Use one key=value pair per line, for example status=failed.',
                        message: 'Optional filter. Use one key=value pair per line, for example status=failed.',
                      })}
                      label={i18n._({ id: 'Filter', message: 'Filter' })}
                      onChange={(event) =>
                        setSubscriptionDraft((current) => ({
                          ...current,
                          filterText: event.target.value,
                        }))
                      }
                      rows={4}
                      value={subscriptionDraft.filterText}
                    />

                    <Switch
                      checked={subscriptionDraft.enabled}
                      label={i18n._({ id: 'Enabled', message: 'Enabled' })}
                      onChange={(event) =>
                        setSubscriptionDraft((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />

                    <div className="notification-center-channel-card">
                      <div className="notification-center-channel-card__header">
                        <div>
                          <h3>{i18n._({ id: 'In-app channel', message: 'In-app channel' })}</h3>
                          <p>
                            {i18n._({
                              id: 'Writes to the selected workspace inbox through notifications.Service.',
                              message: 'Writes to the selected workspace inbox through notifications.Service.',
                            })}
                          </p>
                        </div>
                        <Switch
                          checked={subscriptionDraft.inAppEnabled}
                          label={i18n._({ id: 'Send in-app', message: 'Send in-app' })}
                          onChange={(event) =>
                            setSubscriptionDraft((current) => ({
                              ...current,
                              inAppEnabled: event.target.checked,
                            }))
                          }
                        />
                      </div>
                      {subscriptionDraft.inAppEnabled ? (
                        <div className="notification-center-grid notification-center-grid--compact">
                          <Input
                            label={i18n._({ id: 'Title template', message: 'Title template' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                inAppTitleTemplate: event.target.value,
                              }))
                            }
                            placeholder="{{title}}"
                            value={subscriptionDraft.inAppTitleTemplate}
                          />
                          <TextArea
                            label={i18n._({ id: 'Body template', message: 'Body template' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                inAppBodyTemplate: event.target.value,
                              }))
                            }
                            rows={3}
                            value={subscriptionDraft.inAppBodyTemplate}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="notification-center-channel-card">
                      <div className="notification-center-channel-card__header">
                        <div>
                          <h3>{i18n._({ id: 'Delivery target channel', message: 'Delivery target channel' })}</h3>
                          <p>
                            {i18n._({
                              id: 'Choose a ready delivery target. Notification Center only lists targets that are currently ready to send.',
                              message:
                                'Choose a ready delivery target. Notification Center only lists targets that are currently ready to send.',
                            })}
                          </p>
                        </div>
                        <Switch
                          checked={subscriptionDraft.botEnabled}
                          label={i18n._({ id: 'Send to delivery target', message: 'Send to delivery target' })}
                          onChange={(event) =>
                            setSubscriptionDraft((current) => ({
                              ...current,
                              botEnabled: event.target.checked,
                            }))
                          }
                        />
                      </div>
                      {subscriptionDraft.botEnabled ? (
                        <div className="notification-center-grid notification-center-grid--compact">
                          {!deliveryTargets.length ? (
                            <InlineNotice
                              dismissible={false}
                              noticeKey="notification-center-no-bot-delivery-targets"
                              title={i18n._({
                                id: 'No ready delivery targets',
                                message: 'No ready delivery targets',
                              })}
                              tone="info"
                            >
                              {i18n._({
                                id: 'Notification Center can only use delivery targets that are ready to send. Create or save a contact on the Bots page. For WeChat, ask the recipient to send a message to the bot first.',
                                message:
                                  'Notification Center can only use delivery targets that are ready to send. Create or save a contact on the Bots page. For WeChat, ask the recipient to send a message to the bot first.',
                              })}{' '}
                              <Link to="/bots">
                                {i18n._({
                                  id: 'Open Bots page',
                                  message: 'Open Bots page',
                                })}
                              </Link>
                            </InlineNotice>
                          ) : null}
                          {selectedUnavailableBotTarget ? (
                            <InlineNotice
                              dismissible={false}
                              noticeKey="notification-center-selected-target-not-ready"
                              title={i18n._({
                                id: 'The previously selected target is no longer ready',
                                message: 'The previously selected target is no longer ready',
                              })}
                              tone="error"
                            >
                              {selectedUnavailableBotTarget.deliveryReadinessMessage?.trim()
                                ? selectedUnavailableBotTarget.deliveryReadinessMessage.trim()
                                : i18n._({
                                    id: 'Choose another ready delivery target before saving this subscription.',
                                    message: 'Choose another ready delivery target before saving this subscription.',
                                  })}
                            </InlineNotice>
                          ) : null}
                          <Select
                            label={i18n._({ id: 'Available delivery target', message: 'Available delivery target' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                botTargetId: event.target.value,
                              }))
                            }
                            value={selectedBotTarget ? subscriptionDraft.botTargetId : ''}
                          >
                            <option value="">
                              {i18n._({
                                id: 'Select an available delivery target',
                                message: 'Select an available delivery target',
                              })}
                            </option>
                            {deliveryTargets.map((target) => (
                              <option key={target.id} value={target.id}>
                                {`${workspaceNameById.get(target.workspaceId ?? '') || target.workspaceId || i18n._({ id: 'Unknown workspace', message: 'Unknown workspace' })} · ${target.botName} · ${target.title || target.routeKey || target.id}`}
                              </option>
                            ))}
                          </Select>
                          <div className="notification-center-fact-card">
                            <span className="notification-center-fact-card__label">
                              {i18n._({ id: 'Delivery status', message: 'Delivery status' })}
                            </span>
                            <strong>
                              {selectedBotTarget
                                ? i18n._({ id: 'Ready for Notification Center', message: 'Ready for Notification Center' })
                                : i18n._({ id: 'No target selected', message: 'No target selected' })}
                            </strong>
                            <small>
                              {selectedBotTarget
                                ? `${humanizeDisplayValue(selectedBotTarget.provider)} · ${workspaceNameById.get(selectedBotTarget.workspaceId ?? '') || selectedBotTarget.workspaceId || i18n._({ id: 'Unknown workspace', message: 'Unknown workspace' })} · ${selectedBotTarget.botName} · ${selectedBotTarget.title || selectedBotTarget.routeKey || selectedBotTarget.id}`
                                : i18n._({
                                    id: 'Only ready delivery targets appear here. Manage provider contacts and readiness on the Bots page.',
                                    message: 'Only ready delivery targets appear here. Manage provider contacts and readiness on the Bots page.',
                                  })}
                            </small>
                          </div>
                          {!selectedBotTarget && unavailableDeliveryTargetCount > 0 && deliveryTargets.length ? (
                            <div className="notification-center-fact-card">
                              <span className="notification-center-fact-card__label">
                                {i18n._({ id: 'Hidden targets', message: 'Hidden targets' })}
                              </span>
                              <strong>{unavailableDeliveryTargetCount}</strong>
                              <small>
                                {i18n._({
                                  id: 'Targets that are still waiting for context or provider readiness stay on the Bots page until they become sendable.',
                                  message:
                                    'Targets that are still waiting for context or provider readiness stay on the Bots page until they become sendable.',
                                })}
                              </small>
                            </div>
                          ) : null}
                          <Input
                            label={i18n._({ id: 'Title template', message: 'Title template' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                botTitleTemplate: event.target.value,
                              }))
                            }
                            placeholder="{{title}}"
                            value={subscriptionDraft.botTitleTemplate}
                          />
                          <TextArea
                            label={i18n._({ id: 'Body template', message: 'Body template' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                botBodyTemplate: event.target.value,
                              }))
                            }
                            rows={3}
                            value={subscriptionDraft.botBodyTemplate}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="notification-center-channel-card">
                      <div className="notification-center-channel-card__header">
                        <div>
                          <h3>{i18n._({ id: 'Email channel', message: 'Email channel' })}</h3>
                          <p>
                            {i18n._({
                              id: 'Choose a workspace email target group. Notification Center handles rendering and dispatch audit.',
                              message:
                                'Choose a workspace email target group. Notification Center handles rendering and dispatch audit.',
                            })}
                          </p>
                        </div>
                        <Switch
                          checked={subscriptionDraft.emailEnabled}
                          label={i18n._({ id: 'Send email', message: 'Send email' })}
                          onChange={(event) =>
                            setSubscriptionDraft((current) => ({
                              ...current,
                              emailEnabled: event.target.checked,
                            }))
                          }
                        />
                      </div>
                      {subscriptionDraft.emailEnabled ? (
                        <div className="notification-center-grid notification-center-grid--compact">
                          <Select
                            label={i18n._({ id: 'Email target group', message: 'Email target group' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                emailTargetId: event.target.value,
                              }))
                            }
                            value={subscriptionDraft.emailTargetId}
                          >
                            <option value="">
                              {i18n._({
                                id: 'Select an email target group',
                                message: 'Select an email target group',
                              })}
                            </option>
                            {(emailTargetsQuery.data ?? []).map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.name}
                              </option>
                            ))}
                          </Select>
                          <div className="notification-center-fact-card">
                            <span className="notification-center-fact-card__label">
                              {i18n._({ id: 'Resolved recipients', message: 'Resolved recipients' })}
                            </span>
                            <strong>
                              {selectedEmailTarget?.emails?.length
                                ? selectedEmailTarget.emails.join(', ')
                                : i18n._({ id: 'No target selected', message: 'No target selected' })}
                            </strong>
                            <small>
                              {selectedEmailTarget?.name ??
                                i18n._({
                                  id: 'Create an email target group first if needed.',
                                  message: 'Create an email target group first if needed.',
                                })}
                            </small>
                          </div>
                          <Input
                            label={i18n._({ id: 'Subject template', message: 'Subject template' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                emailTitleTemplate: event.target.value,
                              }))
                            }
                            placeholder="{{title}}"
                            value={subscriptionDraft.emailTitleTemplate}
                          />
                          <TextArea
                            label={i18n._({ id: 'Body template', message: 'Body template' })}
                            onChange={(event) =>
                              setSubscriptionDraft((current) => ({
                                ...current,
                                emailBodyTemplate: event.target.value,
                              }))
                            }
                            rows={3}
                            value={subscriptionDraft.emailBodyTemplate}
                          />
                        </div>
                      ) : null}
                    </div>
                  </form>
                </Modal>
              ) : null}
            </section>

            <section className="notification-center-subsection">
              <div className="notification-center-panel__header">
                <div>
                  <h3>{i18n._({ id: 'Current subscriptions', message: 'Current subscriptions' })}</h3>
              <p>
                {i18n._({
                  id: 'These rules are the single configuration layer for hook, automation, turn policy, delivery failure, and legacy notification events.',
                  message:
                    'These rules are the single configuration layer for hook, automation, turn policy, delivery failure, and legacy notification events.',
                })}
              </p>
                </div>
              </div>

              <div className="notification-center-table-wrap">
                <table className="notification-center-table">
                  <thead>
                    <tr>
                      <th>{i18n._({ id: 'Topic', message: 'Topic' })}</th>
                      <th>{i18n._({ id: 'Channels', message: 'Channels' })}</th>
                      <th>{i18n._({ id: 'Filter', message: 'Filter' })}</th>
                      <th>{i18n._({ id: 'Status', message: 'Status' })}</th>
                      <th>{i18n._({ id: 'Actions', message: 'Actions' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(subscriptionsQuery.data ?? []).length ? (
                      (subscriptionsQuery.data ?? []).map((subscription) => (
                        <tr key={subscription.id}>
                          <td>
                            <strong>{formatTopicLabel(subscription.topic)}</strong>
                            <div className="notification-center-table__subtle">
                              {formatTopicDescription(subscription.topic)}
                            </div>
                          </td>
                          <td>
                            <div className="notification-center-tag-list">
                              {(subscription.channels ?? []).map((channel) => (
                                <span
                                  className="notification-center-tag"
                                  key={`${subscription.id}-${channel.channel}-${channel.targetRefId || channel.targetRefType}`}
                                >
                                  {`${formatChannelLabel(channel.channel)} · ${formatTargetTypeLabel(channel.targetRefType)}`}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <pre className="notification-center-pre">
                              {formatMappingText(subscription.filter ?? undefined) || '—'}
                            </pre>
                          </td>
                          <td>
                            <StatusPill status={subscription.enabled ? 'enabled' : 'disabled'} />
                          </td>
                          <td>
                            <div className="notification-center-actions notification-center-actions--inline">
                              <Button
                                intent="secondary"
                                size="sm"
                                onClick={() => {
                                  setSubscriptionDraft(buildSubscriptionDraft(subscription))
                                  setSubscriptionError('')
                                  saveSubscriptionMutation.reset()
                                  setShowSubscriptionDialog(true)
                                }}
                              >
                                {i18n._({ id: 'Edit', message: 'Edit' })}
                              </Button>
                              <Button
                                intent="danger"
                                isLoading={
                                  deleteSubscriptionMutation.isPending &&
                                  deleteSubscriptionMutation.variables === subscription.id
                                }
                                size="sm"
                                onClick={() => void deleteSubscriptionMutation.mutate(subscription.id)}
                              >
                                {i18n._({ id: 'Delete', message: 'Delete' })}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>
                          {i18n._({
                            id: 'No subscription rules yet.',
                            message: 'No subscription rules yet.',
                          })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>

        <section className="notification-center-panel">
          <div className="notification-center-panel__header">
            <div>
              <h2>{i18n._({ id: 'Dispatch audit', message: 'Dispatch audit' })}</h2>
              <p>
                {i18n._({
                  id: 'Dispatch records are the cross-channel audit trail. Inbox items still live in the inbox UI.',
                  message: 'Dispatch records are the cross-channel audit trail. Inbox items still live in the inbox UI.',
                })}
              </p>
            </div>
          </div>

          <div className="notification-center-filter-row">
            <Select
              label={i18n._({ id: 'Topic filter', message: 'Topic filter' })}
              onChange={(event) =>
                setDispatchFilters((current) => ({ ...current, topic: event.target.value }))
              }
              value={dispatchFilters.topic}
            >
              <option value="">{i18n._({ id: 'All topics', message: 'All topics' })}</option>
              {notificationTopicCatalog.map((topic) => (
                <option key={topic.topic} value={topic.topic}>
                  {formatTopicLabel(topic.topic)}
                </option>
              ))}
            </Select>
            <Select
              label={i18n._({ id: 'Channel filter', message: 'Channel filter' })}
              onChange={(event) =>
                setDispatchFilters((current) => ({ ...current, channel: event.target.value }))
              }
              value={dispatchFilters.channel}
            >
              <option value="">{i18n._({ id: 'All channels', message: 'All channels' })}</option>
              <option value="in_app">{formatChannelLabel('in_app')}</option>
              <option value="bot">{formatChannelLabel('bot')}</option>
              <option value="email">{formatChannelLabel('email')}</option>
            </Select>
            <Select
              label={i18n._({ id: 'Status filter', message: 'Status filter' })}
              onChange={(event) =>
                setDispatchFilters((current) => ({ ...current, status: event.target.value }))
              }
              value={dispatchFilters.status}
            >
              <option value="">{i18n._({ id: 'All statuses', message: 'All statuses' })}</option>
              <option value="pending">{formatLocalizedStatusLabel('pending')}</option>
              <option value="delivered">{formatLocalizedStatusLabel('delivered')}</option>
              <option value="failed">{formatLocalizedStatusLabel('failed')}</option>
            </Select>
          </div>

          <div className="notification-center-table-wrap">
            <table className="notification-center-table">
              <thead>
                <tr>
                  <th>{i18n._({ id: 'Created', message: 'Created' })}</th>
                  <th>{i18n._({ id: 'Topic', message: 'Topic' })}</th>
                  <th>{i18n._({ id: 'Channel', message: 'Channel' })}</th>
                  <th>{i18n._({ id: 'Status', message: 'Status' })}</th>
                  <th>{i18n._({ id: 'Message', message: 'Message' })}</th>
                  <th>{i18n._({ id: 'Actions', message: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody>
                {(dispatchesQuery.data ?? []).length ? (
                  (dispatchesQuery.data ?? []).map((dispatch) => (
                    <tr key={dispatch.id}>
                      <td>{formatLocalizedDateTime(dispatch.createdAt)}</td>
                      <td>
                        <strong>{formatTopicLabel(dispatch.topic)}</strong>
                        <div className="notification-center-table__subtle">{dispatch.eventKey}</div>
                      </td>
                      <td>
                        <div>{formatChannelLabel(dispatch.channel)}</div>
                        <div className="notification-center-table__subtle">
                          {formatTargetTypeLabel(dispatch.targetRefType)}
                        </div>
                      </td>
                      <td>
                        <StatusPill status={dispatch.status} />
                        {dispatch.error ? (
                          <div className="notification-center-table__subtle">{dispatch.error}</div>
                        ) : null}
                      </td>
                      <td>
                        <strong>{dispatch.title || '—'}</strong>
                        <div className="notification-center-table__subtle">
                          {dispatch.message || '—'}
                        </div>
                      </td>
                      <td>
                        {dispatch.status === 'failed' ? (
                          <Button
                            intent="secondary"
                            isLoading={
                              retryDispatchMutation.isPending &&
                              retryDispatchMutation.variables === dispatch.id
                            }
                            size="sm"
                            onClick={() => void retryDispatchMutation.mutate(dispatch.id)}
                          >
                            {i18n._({ id: 'Retry', message: 'Retry' })}
                          </Button>
                        ) : (
                          <span className="notification-center-table__subtle">
                            {dispatch.deliveredAt ? formatLocalizedDateTime(dispatch.deliveredAt) : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      {i18n._({
                        id: 'No dispatch records for the current filter.',
                        message: 'No dispatch records for the current filter.',
                      })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  )
}
