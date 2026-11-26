export { getRunWorkflowCta }
export { getWorkflowLink }

import pc from '@brillout/picocolors'
import type { WorkflowFile } from '../workflowFiles.ts'

/** The GitHub page of the GitHub Action `workflowFile`, which has its **Run workflow** button (or the workflow file path, if the GitHub repository `repo` is unknown) */
function getWorkflowLink(workflowFile: WorkflowFile, repo: string | null) {
  if (!repo) return pc.bold(workflowFile.filePath)
  return pc.underline(`https://github.com/${repo}/actions/workflows/${workflowFile.fileName}`)
}

/** E.g. `go to https://github.com/vikejs/vike/actions/workflows/release-npm.yml, press Run workflow, and ${nextStep}` */
function getRunWorkflowCta(workflowLink: string, nextStep?: string) {
  const press = `press ${pc.bold(pc.cyan('Run workflow'))}` as const
  return nextStep
    ? (`go to ${workflowLink}, ${press}, and ${nextStep}` as const)
    : (`go to ${workflowLink} and ${press}` as const)
}
