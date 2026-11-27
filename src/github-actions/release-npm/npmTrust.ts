export { setUpTrustedPublishers }
export { getNpmTrustArgs }
export { getProvenanceWorkflow }
export { isNpmTrustSupported }
export { isPublishedByTrustedPublisher }

// `$ npm trust github` sets up a package's trusted publisher, see https://docs.npmjs.com/cli/v11/commands/npm-trust
// - It requires npm >= 11.15.0, an npm login, and 2FA (npm asks for it interactively, so only in a terminal).
// - The package must already be on npm.
// - npm allows one trusted publisher per package: it fails if the package already has one.
// - It can't enable "Allow npm dist-tag" (which only removes the dist-tag `commit` of commit releases, see ./cli/ci-publish.ts).
// Reading a package's trusted publisher (`$ npm trust list`) also requires 2FA: instead, release-me checks on npm's registry
// whether the package is already published by its trusted publisher (no login needed).

import pc from '@brillout/picocolors'
import execa from 'execa'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'
import { getNotOnNpmReason } from './githubAction.ts'
import { askConfirmation } from '../../utils/askConfirmation.ts'
import { logDetail } from '../../utils.ts'

const NPM_TRUST_MIN_VERSION = '11.15.0'
// npm's recommendation when setting up several packages
const DELAY_BETWEEN_PACKAGES = 2_000
// The registry of trusted publishing
const REGISTRY = 'https://registry.npmjs.org'
const REGISTRY_TIMEOUT = 10_000
// The dist-tags of the versions that release-npm.yml publishes (`commit`: unless npm let it remove it, see ./cli/ci-publish.ts)
const DIST_TAGS = ['latest', 'commit']

type PublishingStatus =
  /** Its latest stable or commit release is published by its trusted publisher (of release-npm.yml, if the release has provenance) */
  | 'in-use'
  | 'not-in-use'
  | 'not-on-npm'
  /** npm's registry didn't reply (e.g. offline) */
  | 'unknown'

/**
 * Sets up, with `$ npm trust github` and if the user confirms, the trusted publisher of the packages `packageNames` for the
 * GitHub Action release-npm.yml of the GitHub repository `repo` (e.g. `vikejs/vike`). Doesn't ask for the packages already
 * published by their trusted publisher.
 */
async function setUpTrustedPublishers(
  packageNames: string[],
  repo: string,
): Promise<{
  /** Already published by their trusted publisher */
  inUse: string[]
  /** Just set up */
  setUp: string[]
  /** Not set up: the user sets them up on npmjs.com */
  manual: string[]
}> {
  const statuses = await Promise.all(
    packageNames.map(async (packageName) => ({ packageName, status: await getPublishingStatus(packageName, repo) })),
  )
  const getPackages = (status: PublishingStatus) =>
    statuses.filter((s) => s.status === status).map(({ packageName }) => packageName)
  const inUse = getPackages('in-use')
  const notOnNpm = getPackages('not-on-npm')
  for (const packageName of notOnNpm) {
    console.log(pc.yellow(`Warning: ${getNotOnNpmReason(packageName)}.`))
  }
  const toSetUp = getPackages('not-in-use')
  const manual = [...notOnNpm, ...getPackages('unknown')]
  if (toSetUp.length === 0) return { inUse, setUp: [], manual }
  const skip = (reason: string) => {
    console.log(logDetail(reason))
    return { inUse, setUp: [], manual: [...manual, ...toSetUp] }
  }

  // npm asks for 2FA, which requires a terminal
  if (!process.stdin.isTTY || !process.stdout.isTTY) return skip('npm could set it up for you in a terminal')
  const npmVersion = await getNpmVersion()
  if (!npmVersion || !isNpmTrustSupported(npmVersion)) {
    const npmInstalled = npmVersion ? `this machine has npm ${npmVersion}` : "npm isn't installed"
    return skip(`npm >= ${NPM_TRUST_MIN_VERSION} could set it up for you (${npmInstalled})`)
  }
  if (!(await isLoggedIn())) return skip('npm could set it up for you if you were logged in ($ npm login)')

  const packages = toSetUp.join(', ')
  const confirmed = await askConfirmation(
    pc.blue(
      pc.bold(
        `Press <ENTER> to set up the trusted publisher of ${packages} with $ npm trust (npm asks for 2FA), or <CTRL-C> to skip.`,
      ),
    ),
  )
  if (!confirmed) return { inUse, setUp: [], manual: [...manual, ...toSetUp] }

  const setUp: string[] = []
  for (const [i, packageName] of toSetUp.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_PACKAGES))
    // It fails if the package already has a trusted publisher (e.g. set up but not used yet, or for another workflow)
    if (await runNpm(getNpmTrustArgs(packageName, repo))) setUp.push(packageName)
    else manual.push(packageName)
  }
  return { inUse, setUp, manual }
}

async function getPublishingStatus(packageName: string, repo: string): Promise<PublishingStatus> {
  let isOnNpm = false
  for (const distTag of DIST_TAGS) {
    const version = await fetchJson(`${REGISTRY}/${packageName.replace('/', '%2F')}/${distTag}`)
    if (version === undefined) return 'unknown'
    if (version === null) continue
    isOnNpm = true
    if (!isPublishedByTrustedPublisher(version)) continue
    const attestationsUrl = version.dist?.attestations?.provenance && version.dist.attestations.url
    // Commit releases don't have provenance (see ./cli/ci-publish.ts)
    if (!attestationsUrl) return 'in-use'
    const attestations = await fetchJson(attestationsUrl)
    const workflow = attestations && getProvenanceWorkflow(attestations)
    if (!workflow || isReleaseNpmWorkflow(workflow, repo)) return 'in-use'
  }
  return isOnNpm ? 'not-in-use' : 'not-on-npm'
}

function isPublishedByTrustedPublisher(version: any): boolean {
  return version?._npmUser?.trustedPublisher?.id === 'github'
}

type ProvenanceWorkflow = { repository?: string; path?: string }
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

/** `null` upon 404, `undefined` if the registry didn't reply */
async function fetchJson(url: string): Promise<any | null | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT) }).catch(() => null)
  if (!response) return undefined
  if (response.status === 404) return null
  if (!response.ok) return undefined
  return response.json().catch(() => undefined)
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
