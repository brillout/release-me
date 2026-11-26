export { getTrustedPublisherSteps }

import pc from '@brillout/picocolors'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'

/** The steps to set up, on npmjs.com, the trusted publisher of the packages `packageNames` for the GitHub Action release-npm.yml of the GitHub repository `repo` (e.g. `vikejs/vike`) */
function getTrustedPublisherSteps(packageNames: string[], repo: string | null): string[] {
  const [owner, repoName] = repo ? repo.split('/') : []
  const links = packageNames.map((packageName) => pc.underline(`https://www.npmjs.com/package/${packageName}/access`))
  const steps =
    links.length === 1 ? [`   1. Go to ${links[0]}`] : ['   1. Go to:', ...links.map((link) => `        ${link}`)]
  steps.push(`   2. Under ${pc.bold('Trusted Publisher')}, click ${pc.bold('GitHub Actions')} and fill in:`)
  // The fields of npm's form
  const fields = [
    ['Organization or user', owner ?? '<owner>'],
    ['Repository', repoName ?? '<repo>'],
    ['Workflow filename', releaseNpmWorkflowFile.fileName],
    ['Allow npm publish', '✅'],
    // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases (see ./cli/ci-publish.ts)
    ['Allow npm dist-tag', '✅'],
  ] as const
  for (const [label, value] of fields) {
    steps.push(`        ${label.padEnd(22)}${pc.bold(value)}`)
  }
  steps.push(`   3. Click ${pc.bold('Set up connection')}`)
  return steps
}
