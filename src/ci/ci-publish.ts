export { ciPublish }

// `$ release-me ci-publish`: the GitHub Action, builds the released packages and publishes them to npm.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { logTitle, run } from '../utils.ts'
import { isReleaseWorkflowUpToDate, releaseWorkflowFileName, releaseWorkflowOutdated } from './releaseWorkflow.ts'
import {
  build,
  getCommitHash,
  getCommitReleaseVersion,
  getFilesInsideDir,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  updatePackageJsonVersion,
  updateVersionMacro,
  type ReleaseMePackage,
} from '../releaseMe.ts'

async function ciPublish() {
  const monorepoRootDir = await getMonorepoRootDir()
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (!isReleaseWorkflowUpToDate(monorepoRootDir)) fail(releaseWorkflowOutdated)
  // Stable release: its Git tag (`v1.2.3` or `some-package@1.2.3`). Commit release: empty.
  const tag = getEnv('TAG')
  const isCommitRelease = !tag
  const packages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))

  const toPublish = isCommitRelease
    ? await prepareCommitRelease(packages, getEnv('PACKAGE'))
    : [getTaggedPackage(tag, packages)]
  for (const { packageRootDir } of toPublish) {
    await build(packageRootDir)
  }
  const published: string[] = []
  for (const pkg of toPublish) {
    published.push(await publish(pkg, isCommitRelease))
  }
  writeSummary(published, isCommitRelease)
}

/** The package that the Git tag releases */
function getTaggedPackage(tag: string, packages: ReleaseMePackage[]): ReleaseMePackage {
  const releaseTag = parseReleaseTag(tag)
  if (!releaseTag) fail(`${tag} isn't a release tag (v1.2.3 or some-package@1.2.3).`)
  const { packageName, version } = releaseTag
  if (!packageName && packages.length > 1) {
    fail(
      `The Git tag ${tag} is ambiguous: there are several packages (${list(
        packages,
      )}) and their release tags are some-package@1.2.3.`,
    )
  }
  const pkg = packageName ? packages.find((p) => p.packageName === packageName) : packages[0]
  if (!pkg) fail(`The Git tag ${tag} doesn't match any package released by release-me (packages: ${list(packages)}).`)
  const versionPackage = getPackageJson(pkg.packageRootDir).packageJson.version
  if (versionPackage !== version) {
    fail(`The Git tag ${tag} doesn't match the version of ${pkg.packageName}'s package.json (${versionPackage}).`)
  }
  return pkg
}

/**
 * `v1.2.3` => `{ packageName: null, version: '1.2.3' }`
 * `some-package@1.2.3` => `{ packageName: 'some-package', version: '1.2.3' }`
 * `@some-scope/some-package@1.2.3` => `{ packageName: '@some-scope/some-package', version: '1.2.3' }`
 */
function parseReleaseTag(tag: string): { packageName: string | null; version: string } | null {
  // 1.2.3, 1.2.3-beta.1, ...
  const version = '(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.+-]+)?)'
  const single = new RegExp(`^v${version}$`).exec(tag)
  if (single) return { packageName: null, version: single[1]! }
  const monorepo = new RegExp(`^((?:@[\\w.~-]+/)?[\\w.~-]+)@${version}$`).exec(tag)
  if (monorepo) return { packageName: monorepo[1]!, version: monorepo[2]! }
  return null
}

/** Sets the commit release version of the package `packageName` (empty: of all packages) */
async function prepareCommitRelease(packages: ReleaseMePackage[], packageName: string): Promise<ReleaseMePackage[]> {
  const selected = packageName ? packages.filter((p) => p.packageName === packageName) : packages
  if (selected.length === 0) fail(`No package ${packageName} is released by release-me (packages: ${list(packages)}).`)
  const commitHash = await getCommitHash('HEAD')
  // Set all versions before building, so that packages depending on each other reference the commit release versions
  for (const { packageRootDir } of selected) {
    const versionOld = getPackageJson(packageRootDir).packageJson.version!
    const versionNew = getCommitReleaseVersion(versionOld, commitHash)
    await updateVersionMacro(versionOld, versionNew, await getFilesInsideDir(packageRootDir))
    updatePackageJsonVersion(packageRootDir, versionNew)
  }
  return selected
}

/** @returns The published package, e.g. `vike@0.4.271` */
async function publish({ packageName, packageRootDir }: ReleaseMePackage, isCommitRelease: boolean): Promise<string> {
  const { packageJson } = getPackageJson(packageRootDir)
  const spec = `${packageName}@${packageJson.version}`
  logTitle(`Publish ${spec}`)
  if (isPublished(packageName, packageJson.version!)) {
    console.log(`${spec} is already published, skipping it.`)
    return spec
  }
  const tarball = await pack(packageRootDir)
  if (!isCommitRelease) {
    // - npm requires an explicit tag for pre-release versions and for versions lower than the highest published version: use `latest`, as `$ pnpm publish` does (unless package.json#publishConfig.tag is set).
    // - Provenance (npm's default with trusted publishing): the workflow runs on the tag's commit (the pushed tag, or the tag selected in "Use workflow from").
    npm(['publish', tarball, ...(packageJson.publishConfig?.tag ? [] : ['--tag', 'latest'])])
  } else {
    // - `$ npm publish` always sets a dist-tag: use the dist-tag `commit` and remove it afterwards.
    // - No provenance: it would point to the commit the workflow run belongs to (the tip of the branch selected in "Use workflow from"), which isn't necessarily the released commit.
    npm(['publish', tarball, '--tag', 'commit'], { NPM_CONFIG_PROVENANCE: 'false' })
    try {
      npm(['dist-tag', 'rm', packageName, 'commit'])
    } catch {
      console.log(
        `::warning::Couldn't remove the npm dist-tag commit of ${packageName}: on npmjs.com, enable "Allow npm dist-tag" for the trusted publisher ${releaseWorkflowFileName} of ${packageName}.`,
      )
    }
  }
  return spec
}

/** @returns The path of the tarball */
async function pack(packageRootDir: string): Promise<string> {
  // `$ pnpm publish` runs prepublishOnly, whereas `$ pnpm pack` doesn't
  await run('pnpm run --if-present prepublishOnly', { cwd: packageRootDir })
  // `$ pnpm pack` replaces `workspace:` and `catalog:` dependency versions
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-me-'))
  await run(['pnpm', 'pack', '--pack-destination', outDir], { cwd: packageRootDir })
  const [tarball, ...others] = fs.readdirSync(outDir).filter((file) => file.endsWith('.tgz'))
  if (!tarball || others.length > 0) fail(`$ pnpm pack didn't create one tarball in ${outDir}.`)
  return path.join(outDir, tarball)
}

/** The summary of the GitHub Action run */
function writeSummary(published: string[], isCommitRelease: boolean) {
  const { GITHUB_STEP_SUMMARY } = process.env
  if (!GITHUB_STEP_SUMMARY) return
  const lines = published.map((spec) => (isCommitRelease ? `- \`${spec}\` — \`npm install ${spec}\`` : `- \`${spec}\``))
  fs.appendFileSync(GITHUB_STEP_SUMMARY, `### Published to npm\n\n${lines.join('\n')}\n`)
}

function isPublished(packageName: string, version: string): boolean {
  try {
    const stdout = execFileSync('npm', ['view', `${packageName}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return stdout.trim() === version
  } catch {
    return false
  }
}

function npm(args: string[], env: Record<string, string> = {}) {
  console.log(`$ npm ${args.join(' ')}`)
  execFileSync('npm', args, { stdio: 'inherit', env: { ...process.env, ...env } })
}

function list(packages: ReleaseMePackage[]): string {
  return packages.map((p) => p.packageName).join(', ')
}

function getEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) fail(`The environment variable ${name} is missing.`)
  return value
}

/** Fails the GitHub Action, with the message shown as an error annotation */
function fail(msg: string): never {
  console.log(`::error::${msg}`)
  process.exit(1)
}
