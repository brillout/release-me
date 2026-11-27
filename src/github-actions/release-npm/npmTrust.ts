export { setUpTrustedPublishers }
export { getNpmTrustArgs }
export { isNpmTrustSupported }

// `$ npm trust github` creates a package's trusted publisher, see https://docs.npmjs.com/cli/v11/commands/npm-trust
// - It requires npm >= 11.15.0, an npm login, and 2FA (npm asks for it interactively, so only in a terminal).
// - The package must already be on npm.
// - npm allows one trusted publisher per package: it fails if the package already has one.
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

/**
 * Sets up, with `$ npm trust github` and if the user confirms, the trusted publisher of the packages `packageNames` for the
 * GitHub Action release-npm.yml of the GitHub repository `repo` (e.g. `vikejs/vike`).
 *
 * @returns The packages whose trusted publisher wasn't set up (the user sets them up on npmjs.com instead)
 */
async function setUpTrustedPublishers(packageNames: string[], repo: string): Promise<string[]> {
  // npm asks for 2FA, which requires a terminal
  if (!process.stdin.isTTY || !process.stdout.isTTY) return packageNames

  const npmVersion = await getNpmVersion()
  if (!npmVersion || !isNpmTrustSupported(npmVersion)) {
    const npmInstalled = npmVersion ? `this machine has npm ${npmVersion}` : "npm isn't installed"
    console.log(logDetail(`npm >= ${NPM_TRUST_MIN_VERSION} could set it up for you (${npmInstalled})`))
    return packageNames
  }
  if (!(await isLoggedIn())) {
    console.log(logDetail(`npm could set it up for you if you were logged in ($ npm login)`))
    return packageNames
  }

  const packagesOnNpm: string[] = []
  const packagesNotOnNpm: string[] = []
  for (const packageName of packageNames) {
    ;((await isMissingOnNpm(packageName)) ? packagesNotOnNpm : packagesOnNpm).push(packageName)
  }
  for (const packageName of packagesNotOnNpm) {
    console.log(pc.yellow(`Warning: ${getNotOnNpmReason(packageName)}.`))
  }
  if (packagesOnNpm.length === 0) return packageNames

  const packages = packagesOnNpm.join(', ')
  const confirmed = await askConfirmation(
    pc.blue(
      pc.bold(
        `Press <ENTER> to set up the trusted publisher of ${packages} with $ npm trust (npm asks for 2FA), or <CTRL-C> to skip.`,
      ),
    ),
  )
  if (!confirmed) return packageNames

  const packagesFailed: string[] = []
  for (const [i, packageName] of packagesOnNpm.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_PACKAGES))
    const args = getNpmTrustArgs(packageName, repo)
    console.log(pc.bold(pc.blue(`$ npm ${args.join(' ')}`)))
    // Inherit stdio: npm's 2FA prompt requires stdin and stdout to be the terminal
    const { failed } = await execa('npm', args, { stdio: 'inherit', reject: false })
    console.log()
    if (failed) packagesFailed.push(packageName)
  }
  return [...packagesNotOnNpm, ...packagesFailed]
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
