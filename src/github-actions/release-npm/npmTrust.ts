export { setUpTrustedPublishers }
export { getNpmTrustArgs }
export { getTrustedPublisherStatus }
export { isNpmTrustSupported }
export { parseNpmTrustList }
export type { TrustedPublisher }

// `$ npm trust` reads and sets up a package's trusted publisher, see https://docs.npmjs.com/cli/v11/commands/npm-trust
// - It requires npm >= 11.15.0, an npm login, and 2FA (npm asks for it interactively, so only in a terminal).
// - The package must already be on npm.
// - npm allows one trusted publisher per package: replacing it means revoking it first.
// - It can't enable "Allow npm dist-tag" (which only removes the dist-tag `commit` of commit releases, see ./cli/ci-publish.ts).

import pc from '@brillout/picocolors'
import execa from 'execa'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'
import { getNotOnNpmReason, isMissingOnNpm } from './githubAction.ts'
import { askConfirmation } from '../../utils/askConfirmation.ts'
import { logDetail } from '../../utils.ts'

const NPM_TRUST_MIN_VERSION = '11.15.0'
// npm's recommendation when setting up several packages
const DELAY_BETWEEN_PACKAGES = 2_000

/** A trusted publisher, as listed by `$ npm trust list <package> --json` */
type TrustedPublisher = {
  id?: string
  type?: string
  repository?: string
  file?: string
  environment?: string
  permissions?: string[]
}
type TrustedPublisherStatus =
  | { status: 'up-to-date' }
  | { status: 'missing' }
  /** The package has a trusted publisher for another repository or workflow file */
  | { status: 'outdated'; current: TrustedPublisher }
  /** `$ npm trust list` failed (e.g. npm asked for 2FA) */
  | { status: 'unknown' }

/**
 * Sets up, with `$ npm trust` and if the user confirms, the trusted publisher of the packages `packageNames` for the
 * GitHub Action release-npm.yml of the GitHub repository `repo` (e.g. `vikejs/vike`). Doesn't ask if they're all already
 * set up.
 *
 * @param isNewWorkflow Whether init just created (or renamed) release-npm.yml: also set up the packages whose trusted publisher
 * can't be read.
 */
async function setUpTrustedPublishers(
  packageNames: string[],
  repo: string,
  isNewWorkflow: boolean,
): Promise<{
  /** Already set up */
  upToDate: string[]
  /** Just set up */
  setUp: string[]
  /** Not set up: the user sets them up on npmjs.com */
  manual: string[]
}> {
  const skip = (reason: string | null) => {
    // Re-running init: don't repeat it
    if (reason && isNewWorkflow) console.log(logDetail(reason))
    return { upToDate: [], setUp: [], manual: packageNames }
  }
  const npmVersion = await getNpmVersion()
  if (!npmVersion || !isNpmTrustSupported(npmVersion)) {
    const npmInstalled = npmVersion ? `this machine has npm ${npmVersion}` : "npm isn't installed"
    return skip(`npm >= ${NPM_TRUST_MIN_VERSION} could set it up for you (${npmInstalled})`)
  }
  if (!(await isLoggedIn())) return skip(`npm could set it up for you if you were logged in ($ npm login)`)

  const packagesNotOnNpm: string[] = []
  const packagesOnNpm: string[] = []
  for (const packageName of packageNames) {
    ;((await isMissingOnNpm(packageName)) ? packagesNotOnNpm : packagesOnNpm).push(packageName)
  }
  for (const packageName of packagesNotOnNpm) {
    console.log(pc.yellow(`Warning: ${getNotOnNpmReason(packageName)}.`))
  }

  const statuses = await Promise.all(
    packagesOnNpm.map(async (packageName) => ({ packageName, ...(await getStatus(packageName, repo)) })),
  )
  const upToDate = statuses.filter((s) => s.status === 'up-to-date').map((s) => s.packageName)
  const toSetUp = statuses.filter(
    (s) => s.status === 'missing' || s.status === 'outdated' || (s.status === 'unknown' && isNewWorkflow),
  )
  const manual = [
    ...packagesNotOnNpm,
    ...statuses.filter((s) => s.status === 'unknown' && !isNewWorkflow).map((s) => s.packageName),
  ]
  if (toSetUp.length === 0) return { upToDate, setUp: [], manual }
  const toSetUpNames = toSetUp.map((s) => s.packageName)
  // npm asks for 2FA, which requires a terminal
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return { upToDate, setUp: [], manual: [...manual, ...toSetUpNames] }

  console.log(`Trusted publishers to set up with ${pc.bold('$ npm trust')}:`)
  for (const s of toSetUp) {
    const replaces = s.status === 'outdated' ? ` (replaces the one of ${describe(s.current)})` : ''
    console.log(`   ${pc.bold(s.packageName)}${replaces}`)
  }
  const confirmed = await askConfirmation(
    pc.blue(pc.bold('Press <ENTER> to set them up (npm asks for 2FA), or <CTRL-C> to skip.')),
  )
  if (!confirmed) return { upToDate, setUp: [], manual: [...manual, ...toSetUpNames] }

  const setUp: string[] = []
  for (const [i, s] of toSetUp.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_PACKAGES))
    // npm allows one trusted publisher per package
    const revoked =
      s.status !== 'outdated' ||
      !s.current.id ||
      (await runNpm(['trust', 'revoke', s.packageName, '--id', s.current.id]))
    if (revoked && (await runNpm(getNpmTrustArgs(s.packageName, repo)))) setUp.push(s.packageName)
    else manual.push(s.packageName)
  }
  return { upToDate, setUp, manual }
}

async function getStatus(packageName: string, repo: string): Promise<TrustedPublisherStatus> {
  // Not interactive: npm fails instead of asking for 2FA (it only asks if stdin and stdout are the terminal)
  const { stdout, failed } = await execa('npm', ['trust', 'list', packageName, '--json'], {
    stdin: 'ignore',
    reject: false,
  })
  if (failed) return { status: 'unknown' }
  const trustedPublishers = parseNpmTrustList(stdout)
  if (!trustedPublishers) return { status: 'unknown' }
  return getTrustedPublisherStatus(trustedPublishers, repo)
}

function getTrustedPublisherStatus(trustedPublishers: TrustedPublisher[], repo: string): TrustedPublisherStatus {
  const isUpToDate = (t: TrustedPublisher) =>
    (t.type ?? 'github') === 'github' &&
    t.repository?.toLowerCase() === repo.toLowerCase() &&
    t.file === releaseNpmWorkflowFile.fileName &&
    // release-npm.yml doesn't use a GitHub environment
    !t.environment &&
    (!t.permissions || t.permissions.includes('createPackage'))
  if (trustedPublishers.some(isUpToDate)) return { status: 'up-to-date' }
  const current = trustedPublishers[0]
  if (!current) return { status: 'missing' }
  return { status: 'outdated', current }
}

/** `$ npm trust list --json` prints one JSON object per trusted publisher (nothing if there isn't any). `null` if it can't be parsed. */
function parseNpmTrustList(stdout: string): TrustedPublisher[] | null {
  const objects: TrustedPublisher[] = []
  let depth = 0
  let start = -1
  let inString = false
  for (let i = 0; i < stdout.length; i++) {
    const char = stdout[i]
    if (inString) {
      if (char === '\\') i++
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      if (depth++ === 0) start = i
    } else if (char === '}') {
      if (--depth < 0) return null
      if (depth === 0) {
        try {
          objects.push(JSON.parse(stdout.slice(start, i + 1)))
        } catch {
          return null
        }
      }
    } else if (depth === 0 && char!.trim() !== '') {
      return null
    }
  }
  if (depth !== 0) return null
  return objects
}

function describe(trustedPublisher: TrustedPublisher): string {
  const { type, repository, file, environment } = trustedPublisher
  if ((type ?? 'github') !== 'github') return type!
  return [repository, file, environment && `environment ${environment}`].filter(Boolean).join(' ')
}

function getNpmTrustArgs(packageName: string, repo: string): string[] {
  return [
    'trust',
    'github',
    packageName,
    '--file',
    releaseNpmWorkflowFile.fileName,
    '--repository',
    repo,
    '--allow-publish',
    // npm doesn't ask to confirm (release-me already asked)
    '--yes',
  ]
}

/** @returns Whether it succeeded */
async function runNpm(args: string[]): Promise<boolean> {
  console.log(pc.bold(pc.blue(`$ npm ${args.join(' ')}`)))
  // Inherit stdio: npm's 2FA prompt requires stdin and stdout to be the terminal
  const { failed } = await execa('npm', args, { stdio: 'inherit', reject: false })
  console.log()
  return !failed
}

/** Whether npm version `npmVersion` (e.g. `11.20.0`) has `$ npm trust` */
function isNpmTrustSupported(npmVersion: string): boolean {
  const version = parseVersion(npmVersion)
  const minVersion = parseVersion(NPM_TRUST_MIN_VERSION)!
  if (!version) return false
  for (let i = 0; i < 3; i++) {
    if (version[i] !== minVersion[i]) return version[i]! > minVersion[i]!
  }
  return true
}
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** `null` if npm isn't installed */
async function getNpmVersion(): Promise<string | null> {
  const { stdout, failed } = await execa('npm', ['--version'], { reject: false })
  return failed ? null : stdout.trim()
}

async function isLoggedIn(): Promise<boolean> {
  const { failed } = await execa('npm', ['whoami'], { reject: false })
  return !failed
}
