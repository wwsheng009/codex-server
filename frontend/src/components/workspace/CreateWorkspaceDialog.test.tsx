import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'

describe('CreateWorkspaceDialog', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('binds the footer submit button to the workspace form', () => {
    const html = renderToStaticMarkup(
      <CreateWorkspaceDialog
        name="demo-workspace"
        onClose={() => undefined}
        onNameChange={() => undefined}
        onRootPathChange={() => undefined}
        onSubmit={() => undefined}
        rootPath="E:/projects/demo-workspace"
      />,
    )

    const formIdMatch = html.match(/<form[^>]*id="([^"]+)"/)
    expect(formIdMatch?.[1]).toBeTruthy()

    const formId = formIdMatch![1]
    const submitBindingPattern = new RegExp(
      `<button[^>]*(?:type="submit"[^>]*form="${formId}"|form="${formId}"[^>]*type="submit")[^>]*>`,
    )

    expect(html).toMatch(submitBindingPattern)
  })
})
