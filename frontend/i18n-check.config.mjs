export default {
  files: [],
  texts: [
    'English',
  ],
  textPatterns: [
    '/^[A-Za-z]:\\/[\\w./-]+$/i',
  ],
  entries: [
    {
      filePattern: 'src/components/workspace/CreateWorkspaceDialog.tsx',
      attribute: 'placeholder',
      text: 'E:/projects/my-app',
      reason: '示例路径',
    },
  ],
}
