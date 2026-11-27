export { getConnectStep }
export { getCommitReleaseStep }
export { createCommitReleaseStep }
export { logConnected }
export { getPackagesLabel }
export type { ConnectStep }

// The steps (see ../steps.ts) that set up npm <=> GitHub connections (npm's trusted publishers), shared by
// `$ pnpm exec release-me init` and `$ pnpm exec release-me npm-connection`

import * as fs from 'fs'
import * as path from 'path'
import pc from '@brillout/picocolors'
import { createTrustedPublisher } from './npmTrust.ts'
import type { PackageJsonStep } from '../packageJsonSteps.ts'
import type { Step, StepOutcome } from '../steps.ts'
import { getGhUnavailableReason, runWorkflow } from '../utils/gh.ts'
import { getDefaultBranch, getFileOnOrigin } from '../utils/git.ts'
import { getRunWorkflowCta, getWorkflowLink } from '../utils/workflowLink.ts'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'
import { highlightCommand } from '../../utils.ts'

type ConnectStep = Step & { packageName: string }
/** Creates the trusted publisher of the package `packageName` (`$ npm trust github`) */
function getConnectStep(
  packageName: string,
  repo: string,
  notPossibleReason: string | null,
  /** Upon failure, e.g. revoke the old trusted publisher (if npm allows only one) and retry */
  onFailure?: () => Promise<boolean>,
): ConnectStep {
  return {
    packageName,
    label: `Connect ${pc.cyan(packageName)} to GitHub ${pc.dim('($ npm trust github, npm asks for 2FA)')}`,
    notPossibleReason,
    run: async () => (await createTrustedPublisher(packageName, repo)) || (!!onFailure && (await onFailure())),
    // See getTrustedPublisherManual()
    manual: null,
  }
}

type CommitReleaseOptions = {
  repo: string
  allPackageNames: string[]
  connectSteps: ConnectStep[]
  /** The packages whose trusted publisher already exists but may not have published yet */
  packagesToKeep?: string[]
  /** The package.json changes, among them the ones that the GitHub Action requires (it runs with the default branch on GitHub, so they must be pushed) */
  packageJsonSteps: PackageJsonStep[]
  /** The step that pushes the commit (release-npm.yml and the package.json changes) */
  pushStep: Step | null
}
/**
 * Commit-releases the packages that have a new trusted publisher: npm deletes a trusted publisher that doesn't publish
 * within 2 days. `null` if no package can get a new trusted publisher.
 */
async function getCommitReleaseStep(monorepoRootDir: string, options: CommitReleaseOptions): Promise<Step | null> {
  const { connectSteps, packagesToKeep = [] } = options
  if (connectSteps.every((step) => step.notPossibleReason) && packagesToKeep.length === 0) return null
  return createCommitReleaseStep({
    ...options,
    ghUnavailableReason: await getGhUnavailableReason(),
    isWorkflowOnGitHub: await isReleaseNpmOnGitHub(monorepoRootDir),
  })
}
function createCommitReleaseStep({
  repo,
  allPackageNames,
  connectSteps,
  packagesToKeep = [],
  ghUnavailableReason,
  isWorkflowOnGitHub,
  packageJsonSteps,
  pushStep,
}: CommitReleaseOptions & { ghUnavailableReason: string | null; isWorkflowOnGitHub: boolean }): Step {
  const requiredSteps = packageJsonSteps.filter((step) => step.requiredByGitHubAction)
  const workflowLink = getWorkflowLink(releaseNpmWorkflowFile, repo)
  const workflow = pc.bold(releaseNpmWorkflowFile.fileName)
  // The packages to commit-release: the ones connected (or to connect), and the ones to keep
  const getPackageNames = (isConnected: (step: Step) => boolean) =>
    [...connectSteps.filter(isConnected).map(({ packageName }) => packageName), ...packagesToKeep].filter(
      (p, i, all) => all.indexOf(p) === i,
    )
  return {
    label: `Commit-release, so that npm keeps the new connection ${pc.dim(
      `($ gh workflow run ${releaseNpmWorkflowFile.fileName})`,
    )}`,
    notPossibleReason: ghUnavailableReason,
    getNotPossibleReason: (isChecked) => {
      if (getPackageNames(isChecked).length === 0) return 'no package gets a new connection'
      // Otherwise the GitHub Action fails, and npm deletes the new connection
      const missing = requiredSteps.find((step) => !isChecked(step))
      if (missing) return `the GitHub Action requires ${missing.requiredByGitHubAction}`
      if (!(pushStep && isChecked(pushStep))) {
        if (!isWorkflowOnGitHub) return `${workflow} isn't on GitHub yet`
        if (requiredSteps.length > 0) return "the package.json changes aren't on GitHub yet"
      }
      return null
    },
    run: async (isDone) => {
      const packageNames = getPackageNames(isDone)
      // All packages: one commit release (the workflow input `package` is empty)
      const isAll = allPackageNames.every((p) => packageNames.includes(p))
      for (const packageName of isAll ? [''] : packageNames) {
        if (!(await runWorkflow(repo, releaseNpmWorkflowFile.fileName, { package: packageName }))) return false
      }
      const packages = packageNames.map((p) => pc.cyan(p)).join(', ')
      console.log(`GitHub Action ${workflow} will commit-release ${packages}: ${workflowLink}`)
      console.log(
        pc.dim(
          `(If it fails: fix it, then re-run it ${pc.bold(
            'within 2 days',
          )}, otherwise npm deletes the new connection.)`,
        ),
      )
      return true
    },
    manual: (isDone) => {
      // No new connection
      if (getPackageNames(isDone).length === 0) return null
      const isPushed = isWorkflowOnGitHub || (!!pushStep && isDone(pushStep))
      return `${pc.bold(
        'Within 2 days',
      )}, make a commit release (otherwise npm deletes the new connection): run ${highlightCommand(
        '$ pnpm exec release-me commit',
      )}${isPushed ? '' : ` after pushing ${workflow}`}, or ${getRunWorkflowCta(workflowLink)}`
    },
  }
}

/** Logs the packages that the connect steps connected */
function logConnected(connectSteps: ConnectStep[], outcomes: Map<Step, StepOutcome>, allPackageNames: string[]) {
  const connected = connectSteps.filter((step) => outcomes.get(step) === 'done').map(({ packageName }) => packageName)
  if (connected.length === 0) return
  console.log(`${pc.green('✅')} npm <=> GitHub connection set up${getPackagesLabel(connected, allPackageNames)}`)
}

/** Which packages, if only some: e.g. `: vike-react, vike-vue` */
function getPackagesLabel(packageNames: string[], allPackageNames: string[]): string {
  return packageNames.length < allPackageNames.length ? `: ${packageNames.map((p) => pc.bold(p)).join(', ')}` : ''
}

/** Whether the default branch of `origin` has the current release-npm.yml (as of the last `$ git fetch`) */
async function isReleaseNpmOnGitHub(monorepoRootDir: string): Promise<boolean> {
  const defaultBranch = await getDefaultBranch(monorepoRootDir)
  if (!defaultBranch) return false
  const { filePath } = releaseNpmWorkflowFile
  const content = await getFileOnOrigin(monorepoRootDir, defaultBranch, filePath)
  const contentLocal = fs.readFileSync(path.join(monorepoRootDir, filePath), 'utf8').replace(/\r\n/g, '\n')
  return content === contentLocal
}
