import { InlineNotice } from './InlineNotice'
import { i18n } from '../../i18n/runtime'

type FormErrorNoticeProps = {
  error?: string | null
  title: string
  noticeKey?: string
  dismissible?: boolean
}

export function FormErrorNotice({ error, title, noticeKey, dismissible = false }: FormErrorNoticeProps) {
  if (!error) {
    return null
  }

  return (
    <InlineNotice
      dismissible={dismissible}
      noticeKey={noticeKey ?? `form-error-${title}-${error}`}
      title={title || i18n._({ id: 'Form Error', message: 'Form Error' })}
      tone="error"
    >
      {error}
    </InlineNotice>
  )
}
