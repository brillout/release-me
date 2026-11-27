export { getConnectStep }
export { getCommitReleaseStep }
export { getTrustedPublisherManual }
export { isReleaseNpmOnGitHub }
export { npmConnectionCommand }
export type { ConnectStep }

// The steps (see ../steps.ts) that set up npm <=> GitHub connections (npm's trusted publishers), shared by
// `$ pnpm exec release-me init` and `$ pnpm exec release-me npm-connection`

import * as fs from 'fs'
import * as path from 'path'
import pc from '@brillout/picocolors'
import { createTrustedPublisher } from './npmTrust.ts'
import { getTrustedPublisherSteps } from './trustedPublisher.ts'
import type { Step } from '../steps.ts'
import { runWorkflow } from '../utils/gh.ts'
import { getFileOnOrigin } from '../utils/gitPush.ts'
import { getRunWorkflowCta, getWorkflowLink } from '../utils/workflowLink.ts'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'
import { highlightCommand } from '../../utils.ts'

const npmConnectionCommand = '$ pnpm exec release-me npm-connection'

type ConnectStep = Step & { packageName: string; isConnected: boolean; isFailed: boolean }
/** Creates the trusted publisher of the package `packageName` (`$ npm trust github`) */
function getConnectStep(
  packageName: string,
  repo: string,
  notPossibleReason: string | null,
  /** Upon failure, e.g. revoke the old trusted publisher (if npm allows only one) and retry */
  onFailure?: () => Promise<boolean>,
): ConnectStep {
  const step: ConnectStep = {
    packageName,
    isConnected: false,
    isFailed: false,
    label: `Connect ${pc.cyan(packageName)} to GitHub ${pc.dim('($ npm trust github, npm asks for 2FA)')}`,
    notPossibleReason,
    run: async () => {
      step.isConnected = (await createTrustedPublisher(packageName, repo)) || (!!onFailure && (await onFailure()))
      step.isFailed = !step.isConnected
      return step.isConnected
    },
    // See getTrustedPublisherManual()
    manual: null,
  }
  return step
}

/**
 * Commit-releases the packages that have a new trusted publisher: npm deletes a trusted publisher that doesn't publish
 * within 2 days.
 * @param packagesToKeep The packages whose trusted publisher already exists but may not have published yet
 * @param pushStep The step that pushes release-npm.yml (if it isn't on GitHub yet)
 */
function getCommitReleaseStep({
  repo,
  allPackageNames,
  connectSteps,
  packagesToKeep = [],
  ghUnavailableReason,
  isWorkflowOnGitHub,
  pushStep,
}: {
  repo: string
  allPackageNames: string[]
  connectSteps: ConnectStep[]
  packagesToKeep?: string[]
  ghUnavailableReason: string | null
  isWorkflowOnGitHub: boolean
  pushStep: Step | null
}): Step {
  const workflowLink = getWorkflowLink(releaseNpmWorkflowFile, repo)
  const workflow = pc.bold(releaseNpmWorkflowFile.fileName)
  // The packages to commit-release: the ones connected (or to connect), and the ones to keep
  const getPackageNames = (isConnected: (step: ConnectStep) => boolean) =>
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
      if (!isWorkflowOnGitHub && !(pushStep && isChecked(pushStep))) return `${workflow} isn't on GitHub yet`
      return null
    },
    run: async () => {
      const packageNames = getPackageNames((step) => step.isConnected)
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
    manual: () => {
      // No new connection
      if (getPackageNames((step) => step.isConnected).length === 0) return null
      return `${pc.bold(
        'Within 2 days',
      )}, make a commit release (otherwise npm deletes the new connection): run ${highlightCommand(
        '$ pnpm exec release-me commit',
      )}${isWorkflowOnGitHub ? '' : ` after pushing ${workflow}`}, or ${getRunWorkflowCta(workflowLink)}`
    },
  }
}

/** The manual steps to set up the trusted publishers of the packages `packageNames` on npmjs.com */
function getTrustedPublisherManual(packageNames: string[], repo: string | null): string[] {
  const trustedPublisher = `${
    packageNames.length === 1 ? 'the trusted publisher' : 'the trusted publishers'
  } of ${packageNames.map((p) => pc.cyan(p)).join(', ')}`
  return [
    `Set up ${trustedPublisher} on npmjs.com:`,
    ...getTrustedPublisherSteps(packageNames, repo),
    `   ${pc.bold(
      '⚠️  Use it within 2 days',
    )} to persist the connection (e.g. make a commit release) after creating it (otherwise the connection creation is cancelled)`,
  ]
}

/** Whether the default branch of `origin` has the current release-npm.yml (as of the last `$ git fetch`) */
async function isReleaseNpmOnGitHub(monorepoRootDir: string, defaultBranch: string | null): Promise<boolean> {
  if (!defaultBranch) return false
  const { filePath } = releaseNpmWorkflowFile
  const content = await getFileOnOrigin(monorepoRootDir, defaultBranch, filePath)
  const contentLocal = fs.readFileSync(path.join(monorepoRootDir, filePath), 'utf8').replace(/\r\n/g, '\n')
  return content === contentLocal
}
