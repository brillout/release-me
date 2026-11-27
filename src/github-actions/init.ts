export { init }

// `$ pnpm exec release-me init [--npm] [--github]` creates (or updates) .github/workflows/release-npm.yml and/or
// .github/workflows/release-github.yml (see getWorkflowFilesToInit()), then sets up the rest on behalf of the user (see
// ./steps.ts): the package.json fields the GitHub Actions require, npm's trusted publishers, the push, the commit release
// that persists the new trusted publishers, and the first sync of GitHub Releases.

import pc from '@brillout/picocolors'
import { githubReleaseSync } from './release-github/cli/github-release-sync.ts'
import { getGitHubToken } from './release-github/utils/github-env.ts'
import {
  getCommitReleaseStep,
  getConnectStep,
  getTrustedPublisherManual,
  isReleaseNpmOnGitHub,
  npmConnectionCommand,
  type ConnectStep,
} from './release-npm/connectionSteps.ts'
import { getNpmUnavailableReason, getPublishingStatus } from './release-npm/npmTrust.ts'
import { getPackageJsonSteps } from './packageJsonSteps.ts'
import { logManualSteps, runSteps, type Step } from './steps.ts'
import { getGhUnavailableReason } from './utils/gh.ts'
import { getGitHubRepo } from './utils/githubRepo.ts'
import { getCurrentBranch, getDefaultBranch, gitPush, isAheadOfOrigin } from './utils/gitPush.ts'
import {
  getWorkflowFilesToInit,
  releaseGitHubWorkflowFile,
  releaseNpmWorkflowFile,
  writeWorkflowFiles,
  type WorkflowFileOptions,
  type WriteResult,
} from './workflowFiles.ts'
import {
  assertInstalledAtRoot,
  getFilesInsideDir,
  getMonorepoRootDir,
  getReleaseMePackages,
  type ReleaseMePackage,
} from '../releaseMe.ts'
import { highlightCommand, logDetail, logTitle, run } from '../utils.ts'

const initCommand = '$ pnpm exec release-me init'

async function init(options: WorkflowFileOptions) {
  const monorepoRootDir = await getMonorepoRootDir()
  assertInstalledAtRoot(monorepoRootDir)
  const packages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))
  const repo = await getGitHubRepo(monorepoRootDir)

  const results = writeWorkflowFiles(monorepoRootDir, getWorkflowFilesToInit(monorepoRootDir, options))
  const releaseNpmResult = results.find(({ workflowFile }) => workflowFile === releaseNpmWorkflowFile)
  const releaseGitHubResult = results.find(({ workflowFile }) => workflowFile === releaseGitHubWorkflowFile)
  logTitle('GitHub Action', true)
  for (const result of results) {
    const filePath = pc.bold(result.workflowFile.filePath)
    if (result.status === 'up-to-date') console.log(`${filePath} is up-to-date`)
    else if (result.status === 'renamed') console.log(`Renamed ${pc.bold(result.old.filePath)} to ${filePath}`)
    else console.log(`${result.status === 'created' ? 'Created' : 'Updated'} ${filePath}`)
  }

  // package.json
  const changedFiles = new Set<string>()
  const packageJsonSteps = await getPackageJsonSteps(monorepoRootDir, packages, repo, !!releaseNpmResult, changedFiles)
  const steps: Step[] = [...packageJsonSteps]
  const changes = results.filter(({ status }) => status !== 'up-to-date')
  const commitStep: Step = {
    label: 'Commit',
    alwaysRun: true,
    run: () => commitChanges(monorepoRootDir, changes, changedFiles),
    manual: null,
  }
  steps.push(commitStep)

  // npm
  const npm = releaseNpmResult ? await getNpmSteps(packages, repo, releaseNpmResult) : null
  if (npm) steps.push(...npm.connectSteps)

  // Push
  const defaultBranch = await getDefaultBranch(monorepoRootDir)
  const pushStep = await getPushStep(
    monorepoRootDir,
    repo,
    defaultBranch,
    commitStep,
    changes.length > 0 || packageJsonSteps.some((step) => !step.notPossibleReason),
  )
  if (pushStep) steps.push(pushStep)

  // Commit release
  if (npm && repo && npm.connectSteps.some((step) => !step.notPossibleReason)) {
    steps.push(
      getCommitReleaseStep({
        repo,
        allPackageNames: packages.map(({ packageName }) => packageName),
        connectSteps: npm.connectSteps,
        ghUnavailableReason: await getGhUnavailableReason(),
        isWorkflowOnGitHub: await isReleaseNpmOnGitHub(monorepoRootDir, defaultBranch),
        pushStep,
      }),
    )
  }

  // The first sync of GitHub Releases (afterwards, the GitHub Action syncs them upon each CHANGELOG.md change)
  if (releaseGitHubResult?.status === 'created') steps.push(await getGitHubReleaseSyncStep())

  if (steps.some((step) => !step.alwaysRun)) logTitle('Set up')
  const outcomes = await runSteps(steps)
  if (npm) npm.logConnected()

  // The manual steps of npm's trusted publishers: after the package.json steps
  const manualNpm = npm?.getManual() ?? []
  const isTerminal = process.stdin.isTTY && process.stdout.isTTY
  const hints = [
    ...(npm?.getHints() ?? []),
    // Without terminal, release-me can't ask which steps to run
    !isTerminal &&
      steps.some((step) => !step.alwaysRun && !step.notPossibleReason) &&
      `${pc.bold('👉')} To let release-me do it for you, run ${pc.bold(initCommand)} in a terminal`,
  ].filter((hint): hint is string => !!hint)
  const hasManualSteps =
    steps.some(
      (step) => outcomes.get(step) !== 'done' && (typeof step.manual === 'function' ? step.manual() : step.manual),
    ) ||
    manualNpm.length > 0 ||
    hints.length > 0
  if (!hasManualSteps) return
  logTitle('Manual steps')
  logManualSteps(steps, outcomes, { manual: manualNpm, before: steps[steps.indexOf(commitStep) + 1] ?? null })
  for (const hint of hints) console.log(hint)
}

async function commitChanges(monorepoRootDir: string, changes: WriteResult[], changedFiles: Set<string>) {
  // A renamed workflow file: also its removed old file
  const filePaths = [
    ...changes.flatMap((change) =>
      change.status === 'renamed'
        ? [change.old.filePath, change.workflowFile.filePath]
        : [change.workflowFile.filePath],
    ),
    ...changedFiles,
  ]
  if (filePaths.length === 0) return true
  const isSetup = changes.some(({ status }) => status === 'created')
  const commitMessage = isSetup ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'add', '--', ...filePaths], { cwd: monorepoRootDir })
  // Only commit these files (`$ git commit -- <file>` ignores other staged changes)
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', ...filePaths], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)
  return true
}

/** Pushes the commit to the default branch: the GitHub Actions run the workflow files of the default branch */
async function getPushStep(
  monorepoRootDir: string,
  repo: string | null,
  defaultBranch: string | null,
  commitStep: Step,
  willCommit: boolean,
): Promise<Step | null> {
  const branch = await getCurrentBranch(monorepoRootDir)
  if (!willCommit && !(branch && (await isAheadOfOrigin(monorepoRootDir, branch)))) return null
  const getNotPossibleReason = () => {
    if (!repo) return `${pc.cyan('origin')} isn't a GitHub repository ${logDetail('$ git remote get-url origin')}`
    if (!branch) return `${pc.cyan('HEAD')} isn't a branch`
    if (!defaultBranch) return `release-me couldn't determine the default branch of ${pc.cyan('origin')}`
    if (branch !== defaultBranch) {
      return `the current branch is ${pc.cyan(branch)}, not the default branch ${pc.cyan(
        defaultBranch,
      )} (GitHub runs the GitHub Actions of the default branch)`
    }
    return null
  }
  return {
    label: `Push the commit ${pc.dim(`($ git push origin ${defaultBranch ?? branch})`)}`,
    notPossibleReason: getNotPossibleReason(),
    getNotPossibleReason: (isDone) => (isDone(commitStep) ? null : 'the commit failed'),
    run: async () => {
      // E.g. nothing was committed (the user unchecked all package.json steps)
      if (!(await isAheadOfOrigin(monorepoRootDir, branch!))) return true
      return gitPush(monorepoRootDir, branch!)
    },
    manual: `Push the commit to the default branch ${highlightCommand('$ git push')}`,
  }
}

async function getGitHubReleaseSyncStep(): Promise<Step> {
  const syncCommand = '$ pnpm exec release-me github-release-sync'
  return {
    label: `Create the GitHub Releases of CHANGELOG.md ${pc.dim(`(one per version, ${syncCommand})`)}`,
    notPossibleReason: (await getGitHubToken())
      ? null
      : `the environment variable ${pc.bold('GITHUB_TOKEN')} isn't set and the GitHub CLI ${pc.cyan(
          'gh',
        )} isn't logged in: run ${highlightCommand('$ gh auth login')}`,
    run: async () => {
      console.log(pc.bold(pc.blue(syncCommand)))
      try {
        await githubReleaseSync({ packageArgs: [], dryRun: false })
        return true
      } catch (err) {
        console.log(err instanceof Error ? err.message : err)
        return false
      }
    },
    manual: `Create the GitHub Releases of CHANGELOG.md (one per version): run ${highlightCommand(syncCommand)}`,
  }
}

/** The steps that set up the trusted publishers of npm (the ones already set up are left untouched) */
async function getNpmSteps(packages: ReleaseMePackage[], repo: string | null, releaseNpmResult: WriteResult) {
  logTitle('npm trusted publisher')
  const packageNames = packages.map(({ packageName }) => packageName)
  // Only some packages: which ones
  const getPackagesLabel = (names: string[]) =>
    names.length < packageNames.length ? `: ${names.map((p) => pc.bold(p)).join(', ')}` : ''
  const connectSteps: ConnectStep[] = []
  // The packages to set up on npmjs.com, and the ones to publish first
  const manualPackages: string[] = []
  const notOnNpm: string[] = []
  const hints: string[] = []

  if (!repo) {
    console.log(
      `Couldn't determine the GitHub repository of ${pc.cyan('origin')} ${logDetail('$ git remote get-url origin')}`,
    )
    manualPackages.push(...packageNames)
  } else if (releaseNpmResult.status === 'renamed') {
    // The trusted publisher of the old workflow still exists, and its releases look like release-npm.yml's
    const { old } = releaseNpmResult
    console.log(
      `${pc.bold(old.fileName)} was renamed ${pc.bold(releaseNpmWorkflowFile.fileName)}: the connection of ${pc.bold(
        old.fileName,
      )} doesn't work anymore`,
    )
    hints.push(`${pc.bold('👉')} To let release-me do it for you, run ${pc.bold(npmConnectionCommand)}`)
    manualPackages.push(...packageNames)
  } else {
    const statuses = await Promise.all(
      packageNames.map(async (packageName) => ({ packageName, ...(await getPublishingStatus(packageName, repo)) })),
    )
    const inUse = statuses.filter(({ status }) => status === 'in-use').map(({ packageName }) => packageName)
    if (inUse.length > 0) {
      console.log(`${pc.green('✅')} npm <=> GitHub connection up-to-date${getPackagesLabel(inUse)}`)
      console.log(`${pc.bold('👉')} For more info, run ${pc.bold(npmConnectionCommand)}`)
    }
    const toConnect = statuses.filter(({ status }) => status === 'not-in-use')
    const npmUnavailableReason = toConnect.length > 0 ? await getNpmUnavailableReason() : null
    for (const { packageName, status } of statuses) {
      if (status === 'in-use') continue
      if (status === 'not-in-use') {
        connectSteps.push(getConnectStep(packageName, repo, npmUnavailableReason))
      } else if (status === 'not-on-npm') {
        const publish = highlightCommand('$ pnpm publish')
        connectSteps.push(
          getConnectStep(packageName, repo, `it isn't on npm yet: publish its first version manually (${publish})`),
        )
        notOnNpm.push(packageName)
      } else {
        connectSteps.push(getConnectStep(packageName, repo, "npm's registry didn't reply"))
        manualPackages.push(packageName)
      }
    }
  }

  return {
    connectSteps,
    logConnected() {
      const connected = connectSteps.filter((step) => step.isConnected).map(({ packageName }) => packageName)
      if (connected.length === 0) return
      console.log(`${pc.green('✅')} npm <=> GitHub connection set up${getPackagesLabel(connected)}`)
    },
    /** The manual steps of the trusted publishers that weren't set up */
    getManual(): string[][] {
      const notConnected = connectSteps
        .map(({ packageName, isConnected }) => !isConnected && packageName)
        .filter((p): p is string => !!p && !manualPackages.includes(p) && !notOnNpm.includes(p))
      const packageNamesManual = [...manualPackages, ...notConnected]
      const manual: string[][] = notOnNpm.map((packageName) => [
        `Publish the first version of ${pc.cyan(packageName)} manually (${highlightCommand(
          '$ pnpm publish',
        )}), then run ${pc.bold(initCommand)} again`,
      ])
      if (packageNamesManual.length > 0) {
        const lines = getTrustedPublisherManual(packageNamesManual, repo)
        if (releaseNpmResult.status === 'renamed') {
          lines.splice(-1, 0, `   4. Delete the trusted publisher of ${pc.bold(releaseNpmResult.old.fileName)}`)
        }
        manual.push(lines)
      }
      return manual
    },
    getHints(): string[] {
      // E.g. npm allows only one trusted publisher per package, and the package already has one
      if (connectSteps.some((step) => step.isFailed)) {
        return [...hints, `${pc.bold('👉')} To replace the existing connection, run ${pc.bold(npmConnectionCommand)}`]
      }
      return hints
    },
  }
}
