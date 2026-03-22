import { ThreadPageLayout } from './thread-page/ThreadPageLayout'
import { useThreadPageController } from './thread-page/useThreadPageController'

export function ThreadPage() {
  const threadPageLayoutProps = useThreadPageController()

  return <ThreadPageLayout {...threadPageLayoutProps} />
}
