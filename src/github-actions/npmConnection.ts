export { npmConnection }

// `$ pnpm exec release-me npm-connection` shows and fixes the npm <=> GitHub connections (npm's trusted publishers):
// 1. Without login: whether each package's latest release was published by the connection of release-npm.yml (npm's registry).
// 2. With login (2FA): the connections npm has (`$ npm trust list`), and whether they're the ones of release-npm.yml.
// 3. The steps that fix them (see ./steps.ts): add the missing connections, commit-release to persist them, and delete
//    the old ones (e.g. the ones of release.yml, or of another repository).

import pc from '@brillout/picocolors'
import { getCommitReleaseStep, getConnectStep, logConnected, type ConnectStep } from './release-npm/connectionSteps.ts'
import { describeWorkflow, getPublishingStatus, type PublishingStatus } from './release-npm/npmRegistry.ts'
import {
  createTrustedPublisher,
  describeTrustedPublisher,
  getNpmUnavailableReason,
  isExpectedTrustedPublisher,
  listTrustedPublishers,
  revokeTrustedPublisher,
  type TrustedPublisher,
} from './release-npm/npmTrust.ts'
import { getTrustedPublisherManual } from './release-npm/trustedPublisher.ts'
import { getPackageJsonSteps, type PackageJsonStep } from './packageJsonSteps.ts'
import { logManualSteps, runSteps, type Step, type StepOutcome } from './steps.ts'
import { getGitHubRepo } from './utils/githubRepo.ts'
import { isWorkflowFileUpToDate, releaseNpmWorkflowFile } from './workflowFiles.ts'
import { assertInstalledAtRoot, getFilesInsideDir, getMonorepoRootDir, getReleaseMePackages } from '../releaseMe.ts'
import { askConfirmation, isTerminal } from '../utils/ask.ts'
import { assertUsage, highlightCommand, logDetail, logTitle } from '../utils.ts'

async function npmConnection() {
  const monorepoRootDir = await getMonorepoRootDir()
  assertInstalledAtRoot(monorepoRootDir)
  const packages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))
  const packageNames = packages.map(({ packageName }) => packageName)
  const repo = await getGitHubRepo(monorepoRootDir)
  assertUsage(
    repo,
    `Couldn't determine the GitHub repository of ${pc.cyan('origin')} ${logDetail('$ git remote get-url origin')}.`,
  )
  assertUsage(
    isWorkflowFileUpToDate(monorepoRootDir, releaseNpmWorkflowFile),
    `${pc.bold(releaseNpmWorkflowFile.filePath)} is missing or outdated: run ${pc.bold(
      '$ pnpm exec release-me init',
    )} first.`,
  )

  // 1. npm's registry
  logTitle('npm trusted publisher', true)
  const statuses = new Map<string, PublishingStatus>()
  await Promise.all(
    packageNames.map(async (packageName) => statuses.set(packageName, await getPublishingStatus(packageName, repo))),
  )
  for (const packageName of packageNames) logPublishingStatus(packageName, statuses.get(packageName)!)
  const packageNamesOnNpm = packageNames.filter((p) => ['in-use', 'not-in-use'].includes(statuses.get(p)!.status))

  // 2. The connections npm has
  const npmUnavailableReason = packageNamesOnNpm.length > 0 ? await getNpmUnavailableReason() : null
  const trustedPublishers = await readTrustedPublishers(packageNamesOnNpm, repo, npmUnavailableReason)

  // 3. The steps that fix them
  const { connectSteps, deleteSteps, packagesToKeep } = getFixSteps(
    packageNamesOnNpm,
    statuses,
    trustedPublishers,
    repo,
    npmUnavailableReason,
  )
  // The package.json changes that the GitHub Action requires: `$ pnpm exec release-me init` makes them
  const packageJsonSteps = await getPackageJsonSteps(monorepoRootDir, packages, repo, true)
  const commitReleaseStep = await getCommitReleaseStep(monorepoRootDir, {
    repo,
    allPackageNames: packageNames,
    connectSteps,
    packagesToKeep,
    packageJsonSteps,
    pushStep: null,
  })
  const steps: Step[] = [...connectSteps, ...deleteSteps, ...(commitReleaseStep ? [commitReleaseStep] : [])]
  if (steps.length === 0) {
    if (trustedPublishers) console.log(`${pc.green('✅')} Nothing to fix`)
    return
  }

  logTitle('Set up')
  const outcomes = await runSteps(steps)
  logConnected(connectSteps, outcomes, packageNames)
  logNpmConnectionManualSteps(steps, outcomes, { connectSteps, commitReleaseStep, packageJsonSteps, repo })
}

/**
 * The manual steps: the ones of the steps that weren't done, the npmjs.com setup of the packages that weren't connected
 * (after deleting the old connections: npm may allow only one connection per package), and the package.json fixes (before
 * the commit release)
 */
function logNpmConnectionManualSteps(
  steps: Step[],
  outcomes: Map<Step, StepOutcome>,
  {
    connectSteps,
    commitReleaseStep,
    packageJsonSteps,
    repo,
  }: { connectSteps: ConnectStep[]; commitReleaseStep: Step | null; packageJsonSteps: PackageJsonStep[]; repo: string },
) {
  const notConnected = connectSteps
    .filter((step) => outcomes.get(step) !== 'done')
    .map(({ packageName }) => packageName)
  const manual = notConnected.length > 0 ? [getTrustedPublisherManual(notConnected, repo)] : []
  const requiredSteps = commitReleaseStep ? packageJsonSteps.filter((step) => step.requiredByGitHubAction) : []
  if (requiredSteps.length > 0) {
    const requirements = requiredSteps.map((step) => step.requiredByGitHubAction).join(', ')
    manual.push([
      `Fix package.json: run ${highlightCommand(
        '$ pnpm exec release-me init',
      )} (the GitHub Action requires ${requirements})`,
    ])
  }
  logManualSteps(steps, outcomes, { manual, before: commitReleaseStep })
}

/**
 * The steps that fix the connections of the packages `packageNames`: connect the ones without the connection of
 * release-npm.yml, and delete the old connections. If the connections npm has weren't read (`trustedPublishers` is
 * `null`): according to npm's registry.
 */
function getFixSteps(
  packageNames: string[],
  statuses: Map<string, PublishingStatus>,
  trustedPublishers: Map<string, TrustedPublisher[] | null> | null,
  repo: string,
  npmUnavailableReason: string | null,
) {
  const connectSteps: ConnectStep[] = []
  const deleteSteps: Step[] = []
  // The packages whose connection exists but may not have published yet: it expires 2 days after its creation
  const packagesToKeep: string[] = []
  // Deleted by the connect step (see getReplaceOld()) or by the delete step
  const revokedIds = new Set<string>()
  const revoke = async (packageName: string, id: string) => {
    if (revokedIds.has(id)) return true
    const isRevoked = await revokeTrustedPublisher(packageName, id)
    if (isRevoked) revokedIds.add(id)
    return isRevoked
  }
  for (const packageName of packageNames) {
    const status = statuses.get(packageName)!
    const list = trustedPublishers?.get(packageName)
    if (!list) {
      if (status.status === 'not-in-use') connectSteps.push(getConnectStep(packageName, repo, npmUnavailableReason))
      continue
    }
    const old = list.filter((t) => !isExpectedTrustedPublisher(t, repo) && t.id)
    let connectStep: ConnectStep | null = null
    if (!list.some((t) => isExpectedTrustedPublisher(t, repo))) {
      connectStep = getConnectStep(packageName, repo, null, getReplaceOld(packageName, old, repo, revoke))
      connectSteps.push(connectStep)
    } else if (status.status !== 'in-use') {
      packagesToKeep.push(packageName)
    }
    for (const t of old) {
      deleteSteps.push({
        label: `Delete the old connection of ${pc.cyan(packageName)} ${pc.dim(`(${describeTrustedPublisher(t)})`)}`,
        getNotPossibleReason: (isChecked) =>
          connectStep && !isChecked(connectStep) ? `${pc.cyan(packageName)} would have no connection left` : null,
        run: () => revoke(packageName, t.id!),
        manual: `Delete the old connection of ${pc.cyan(packageName)} (${describeTrustedPublisher(
          t,
        )}) at ${pc.underline(`https://www.npmjs.com/package/${packageName}/access`)}`,
      })
    }
  }
  return { connectSteps, deleteSteps, packagesToKeep }
}

/**
 * If npm refuses to connect the package `packageName`: deletes its old connections `old`, then connects it again. npm
 * may allow only one trusted publisher per package (https://docs.npmjs.com/cli/v11/commands/npm-trust). Upon the
 * user's confirmation, as npm may have refused for another reason (e.g. 2FA).
 */
function getReplaceOld(
  packageName: string,
  old: TrustedPublisher[],
  repo: string,
  revoke: (packageName: string, id: string) => Promise<boolean>,
) {
  return async () => {
    if (old.length === 0) return false
    const oldOnes = old.map((t) => pc.bold(describeTrustedPublisher(t))).join(', ')
    const isConfirmed = await askConfirmation(
      pc.blue(
        pc.bold(
          `npm refused to connect ${pc.cyan(
            packageName,
          )} (see above), maybe because npm allows only one connection per package. Press <ENTER> to delete the old connection (${oldOnes}) and retry, or <CTRL-C> to skip.`,
        ),
      ),
    )
    if (!isConfirmed) return false
    for (const t of old) if (!(await revoke(packageName, t.id!))) return false
    return createTrustedPublisher(packageName, repo)
  }
}

function logPublishingStatus(packageName: string, status: PublishingStatus) {
  const pkg = pc.cyan(packageName)
  const accessLink = pc.dim(pc.underline(`https://www.npmjs.com/package/${packageName}/access`))
  if (status.status === 'in-use') {
    const by = status.workflow
      ? `its connection ${logDetail(describeWorkflow(status.workflow))}`
      : `a connection ${logDetail("a commit release, which doesn't tell which workflow")}`
    console.log(`${pc.green('✅')} ${pkg}: ${pc.bold(status.version)} was published by ${by} ${accessLink}`)
  } else if (status.status === 'not-in-use') {
    const by = status.otherWorkflow
      ? `the connection of ${pc.bold(describeWorkflow(status.otherWorkflow))}`
      : status.publisher
        ? pc.bold(status.publisher)
        : 'someone else'
    console.log(
      `${pc.red('❌')} ${pkg}: ${pc.bold(status.version)} was published by ${by}, not by the connection of ${pc.bold(
        releaseNpmWorkflowFile.fileName,
      )} ${accessLink}`,
    )
  } else if (status.status === 'not-on-npm') {
    console.log(
      `${pc.yellow('⚠️')}  ${pkg} isn't on npm yet: publish its first version manually (${highlightCommand(
        '$ pnpm publish',
      )}), then run this command again`,
    )
  } else {
    console.log(`${pc.yellow('⚠️')}  ${pkg}: npm's registry didn't reply`)
  }
}

/** The connections npm has (`$ npm trust list`), if the user agrees (npm asks for 2FA). `null` if not read. */
async function readTrustedPublishers(
  packageNames: string[],
  repo: string,
  npmUnavailableReason: string | null,
): Promise<Map<string, TrustedPublisher[] | null> | null> {
  if (packageNames.length === 0) return null
  if (npmUnavailableReason) {
    console.log(pc.dim(`(release-me can't read the connections npm has, because ${npmUnavailableReason})`))
    return null
  }
  if (!isTerminal()) {
    console.log(pc.dim('(release-me can read the connections npm has in a terminal: npm asks for 2FA)'))
    return null
  }
  console.log()
  const isConfirmed = await askConfirmation(
    pc.blue(
      pc.bold(
        `Press <ENTER> to read the connections npm has ($ npm trust list), or <CTRL-C> to skip. npm asks for 2FA: let npm skip 2FA for the next 5 minutes, so that it asks only once.`,
      ),
    ),
  )
  if (!isConfirmed) return null
  const trustedPublishers = new Map<string, TrustedPublisher[] | null>()
  for (const packageName of packageNames) {
    const list = await listTrustedPublishers(packageName)
    trustedPublishers.set(packageName, list)
    if (!list) continue
    if (list.length === 0) {
      console.log(`${pc.red('❌')} ${pc.cyan(packageName)} has no connection`)
      continue
    }
    for (const t of list) {
      const isExpected = isExpectedTrustedPublisher(t, repo)
      console.log(
        `${isExpected ? pc.green('✅') : pc.red('❌')} ${pc.cyan(packageName)}: connection ${pc.bold(
          describeTrustedPublisher(t),
        )}${isExpected ? '' : ` ${pc.dim(`(not ${repo} ${releaseNpmWorkflowFile.fileName})`)}`}`,
      )
    }
  }
  return trustedPublishers
}
