export { getPublishingStatus }
export { getNpmUnavailableReason }
export { createTrustedPublisher }
export { revokeTrustedPublisher }
export { listTrustedPublishers }
export { parseNpmTrustList }
export { isExpectedTrustedPublisher }
export { describeTrustedPublisher }
export { describeWorkflow }
export { getNpmTrustArgs }
export { getOtpRequest }
export { getProvenanceWorkflow }
export { isNpmTrustSupported }
export { isPublishedByTrustedPublisher }
export type { PublishingStatus }
export type { TrustedPublisher }

// A package's trusted publisher is its npm <=> GitHub connection: it lets the GitHub Action release-npm.yml publish it.
// - On npm's registry (no login needed): whether a release was published by a trusted publisher, and, if the release has
//   provenance (stable releases), by which workflow.
// - `$ npm trust` lists, creates, and revokes trusted publishers, see https://docs.npmjs.com/cli/v11/commands/npm-trust
//   - It requires npm >= 11.15.0, an npm login, and 2FA (npm asks for it only if stdin and stdout are the terminal; the
//     user can let npm skip 2FA for the next 5 minutes).
//   - The package must already be on npm.
//   - A new trusted publisher must publish within 2 days, otherwise it expires.
//   - It can't enable "Allow npm dist-tag" (which only removes the dist-tag `commit` of commit releases, see ./cli/ci-publish.ts).

import readline from 'node:readline'
import pc from '@brillout/picocolors'
import execa from 'execa'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'
import { highlightCommand, logDetail } from '../../utils.ts'

const NPM_TRUST_MIN_VERSION = '11.15.0'
// npm's recommendation when setting up several packages
const DELAY_BETWEEN_PACKAGES = 2_000
// The registry of trusted publishing
const REGISTRY = 'https://registry.npmjs.org'
const REGISTRY_TIMEOUT = 10_000
// The dist-tags of the versions that release-npm.yml publishes (`commit`: unless npm let it remove it, see ./cli/ci-publish.ts)
const DIST_TAGS = ['latest', 'commit']

type ProvenanceWorkflow = { repository?: string; path?: string }
type PublishingStatus =
  /** The release `version` was published by a trusted publisher (of release-npm.yml, if the release has provenance) */
  | { status: 'in-use'; version: string; workflow: ProvenanceWorkflow | null }
  /** The latest release `version` wasn't published by the trusted publisher of release-npm.yml */
  | {
      status: 'not-in-use'
      version: string
      /** The npm user who published it, e.g. `brillout` */
      publisher: string | null
      /** The workflow of the trusted publisher that published it, if it isn't release-npm.yml (e.g. release.yml) */
      otherWorkflow: ProvenanceWorkflow | null
    }
  | { status: 'not-on-npm' }
  /** npm's registry didn't reply (e.g. offline) */
  | { status: 'unknown' }

/** A trusted publisher, as listed by `$ npm trust list <package> --json` */
type TrustedPublisher = {
  id?: string
  type?: string
  repository?: string
  file?: string
  environment?: string
  permissions?: string[]
}

/** Whether the package `packageName` is published by the trusted publisher of the GitHub Action release-npm.yml of the GitHub repository `repo` (e.g. `vikejs/vike`), according to npm's registry */
async function getPublishingStatus(packageName: string, repo: string): Promise<PublishingStatus> {
  let latest: { version: string; publisher: string | null; otherWorkflow: ProvenanceWorkflow | null } | null = null
  for (const distTag of DIST_TAGS) {
    const release = await fetchJson(`${REGISTRY}/${packageName.replace('/', '%2F')}/${distTag}`)
    if (release === undefined) return { status: 'unknown' }
    if (release === null) continue
    const { version } = release
    let otherWorkflow: ProvenanceWorkflow | null = null
    if (isPublishedByTrustedPublisher(release)) {
      const attestationsUrl = release.dist?.attestations?.provenance && release.dist.attestations.url
      // Commit releases don't have provenance (see ./cli/ci-publish.ts)
      if (!attestationsUrl) return { status: 'in-use', version, workflow: null }
      const attestations = await fetchJson(attestationsUrl)
      const workflow = attestations && getProvenanceWorkflow(attestations)
      if (!workflow || isReleaseNpmWorkflow(workflow, repo)) return { status: 'in-use', version, workflow }
      otherWorkflow = workflow
    }
    latest ??= { version, publisher: release._npmUser?.name ?? null, otherWorkflow }
  }
  if (!latest) return { status: 'not-on-npm' }
  return { status: 'not-in-use', ...latest }
}

function isPublishedByTrustedPublisher(release: any): boolean {
  return release?._npmUser?.trustedPublisher?.id === 'github'
}

/** The GitHub Action that published a release, according to its npm provenance */
function getProvenanceWorkflow(attestations: any): ProvenanceWorkflow | null {
  for (const attestation of attestations?.attestations ?? []) {
    if (attestation?.predicateType !== 'https://slsa.dev/provenance/v1') continue
    const payload = attestation.bundle?.dsseEnvelope?.payload
    if (typeof payload !== 'string') continue
    try {
      const statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
      const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow
      if (workflow) return { repository: workflow.repository, path: workflow.path }
    } catch {}
  }
  return null
}
function isReleaseNpmWorkflow(workflow: ProvenanceWorkflow, repo: string): boolean {
  return (
    workflow.repository?.toLowerCase() === `https://github.com/${repo}`.toLowerCase() &&
    workflow.path === releaseNpmWorkflowFile.filePath
  )
}
/** E.g. `vikejs/vike .github/workflows/release.yml` */
function describeWorkflow(workflow: ProvenanceWorkflow): string {
  const repository = workflow.repository?.replace(/^https:\/\/github\.com\//, '')
  return [repository, workflow.path].filter(Boolean).join(' ')
}

/** `null` upon 404, `undefined` if the registry didn't reply */
async function fetchJson(url: string): Promise<any | null | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT) }).catch(() => null)
  if (!response) return undefined
  if (response.status === 404) return null
  if (!response.ok) return undefined
  return response.json().catch(() => undefined)
}

/** Why `$ npm trust` can't be used (npm is missing or too old, or it isn't logged in), otherwise `null` */
async function getNpmUnavailableReason(): Promise<string | null> {
  const npmVersion = await getNpmVersion()
  if (!npmVersion) return "npm isn't installed"
  if (!isNpmTrustSupported(npmVersion)) {
    return `npm ${npmVersion} doesn't have ${pc.bold(
      '$ npm trust',
    )} (npm >= ${NPM_TRUST_MIN_VERSION} does): run ${highlightCommand('$ npm install -g npm')}`
  }
  if (!(await isLoggedIn())) return `npm isn't logged in: run ${highlightCommand('$ npm login')}`
  return null
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

let lastNpmTrustRun = 0
/** Not too many `$ npm trust` calls at once */
async function throttle() {
  const wait = lastNpmTrustRun + DELAY_BETWEEN_PACKAGES - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastNpmTrustRun = Date.now()
}

/** Creates the trusted publisher of the GitHub Action release-npm.yml of the GitHub repository `repo`. @returns Whether it succeeded */
async function createTrustedPublisher(packageName: string, repo: string): Promise<boolean> {
  await throttle()
  return runNpm(getNpmTrustArgs(packageName, repo))
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
async function revokeTrustedPublisher(packageName: string, id: string): Promise<boolean> {
  await throttle()
  return runNpm(['trust', 'revoke', packageName, '--id', id])
}

/** @returns Whether it succeeded */
async function runNpm(args: string[]): Promise<boolean> {
  console.log(pc.bold(pc.blue(`$ npm ${args.join(' ')}`)))
  // Inherit stdio: npm's 2FA prompt requires stdin and stdout to be the terminal
  const { failed } = await execa('npm', args, { stdio: 'inherit', reject: false })
  console.log()
  return !failed
}

/**
 * The trusted publishers of the package `packageName` (`null` if `$ npm trust list` failed).
 *
 * Reading npm's JSON output means npm doesn't have the terminal, so npm fails instead of asking for 2FA. Then:
 * - 2FA in the browser: npm asks for it in the terminal (the user can let npm skip 2FA for the next 5 minutes), then
 *   release-me reads the JSON output again.
 * - 2FA with an authenticator app: release-me asks for the one-time password.
 */
async function listTrustedPublishers(packageName: string): Promise<TrustedPublisher[] | null> {
  const args = ['trust', 'list', packageName, '--json']
  await throttle()
  let result = await runNpmJson(args)
  if (result.otpRequest === 'web') {
    await runNpm(['trust', 'list', packageName])
    result = await runNpmJson(args)
  } else if (result.otpRequest === 'classic') {
    const otp = await askOtp()
    if (otp) result = await runNpmJson([...args, '--otp', otp])
  }
  if (result.otpRequest) {
    console.log(
      pc.yellow(
        `npm asked for 2FA again: let npm skip 2FA for the next 5 minutes, so that release-me can read ${pc.bold(
          packageName,
        )}'s trusted publishers.`,
      ),
    )
    return null
  }
  if (result.failed) {
    console.log(pc.yellow(`${pc.bold(`$ npm ${args.join(' ')}`)} failed:`))
    console.log(result.output)
    return null
  }
  const trustedPublishers = parseNpmTrustList(result.stdout)
  if (!trustedPublishers) {
    console.log(pc.yellow(`Couldn't read the output of ${pc.bold(`$ npm ${args.join(' ')}`)}:`))
    console.log(result.stdout)
  }
  return trustedPublishers
}
async function runNpmJson(args: string[]) {
  const { stdout, stderr, failed } = await execa('npm', args, { stdin: 'ignore', reject: false })
  const output = [stdout, stderr].filter(Boolean).join('\n')
  return { stdout, output, failed, otpRequest: failed ? getOtpRequest(output) : null }
}
/** Whether npm failed because it requires 2FA: in the browser (`web`), or with an authenticator app (`classic`) */
function getOtpRequest(output: string): 'web' | 'classic' | null {
  if (!/EOTP|one-time pass/.test(output)) return null
  return output.includes('authUrl') && output.includes('doneUrl') ? 'web' : 'classic'
}
function askOtp(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let answer: string | null = null
    rl.question(pc.bold('npm requires a one-time password (2FA): enter it '), (a) => {
      answer = a.trim()
      rl.close()
    })
    rl.on('SIGINT', () => rl.close())
    rl.on('close', () => resolve(answer || null))
  })
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

/** Whether `trustedPublisher` is the trusted publisher of the GitHub Action release-npm.yml of the GitHub repository `repo` */
function isExpectedTrustedPublisher(trustedPublisher: TrustedPublisher, repo: string): boolean {
  const { type, repository, file, environment, permissions } = trustedPublisher
  return (
    (type ?? 'github') === 'github' &&
    repository?.toLowerCase() === repo.toLowerCase() &&
    file === releaseNpmWorkflowFile.fileName &&
    // release-npm.yml doesn't use a GitHub environment
    !environment &&
    // `--allow-publish`
    (!permissions || permissions.includes('createPackage'))
  )
}

/** E.g. `vikejs/vike release.yml` */
function describeTrustedPublisher(trustedPublisher: TrustedPublisher): string {
  const { type, repository, file, environment, permissions } = trustedPublisher
  if ((type ?? 'github') !== 'github') return type!
  return [
    repository,
    file,
    environment && `environment ${environment}`,
    permissions && !permissions.includes('createPackage') && logDetail("can't publish"),
  ]
    .filter(Boolean)
    .join(' ')
}
