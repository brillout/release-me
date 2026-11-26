export { ciPublish }

// `$ pnpm exec release-me ci-publish`, run by the GitHub Action (see ../../workflowFiles.ts), builds the released packages and publishes them to npm.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import execa from 'execa'
import pc from '@brillout/picocolors'
import { logTitle, run } from '../../../utils.ts'
import { fail } from '../../utils/fail.ts'
import { isWorkflowFileUpToDate, releaseNpmWorkflowFile } from '../../workflowFiles.ts'
import { getNotOnNpmReason, isMissingOnNpm } from '../githubAction.ts'
import { getTrustedPublisherSteps } from '../trustedPublisher.ts'
import { getPackagesToBuild, type WorkspacePackage } from '../buildOrder.ts'
import {
  build,
  getCommitHash,
  getCommitReleaseVersion,
  getFilesInsideDir,
  getFilesMonorepoPackageJson,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  updatePackageJsonVersion,
  updateVersionMacro,
  type ReleaseMePackage,
} from '../../../releaseMe.ts'

async function ciPublish() {
  const monorepoRootDir = await getMonorepoRootDir()
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (!isWorkflowFileUpToDate(monorepoRootDir, releaseNpmWorkflowFile)) fail(releaseNpmWorkflowFile.outdated)
  // Stable release: its Git tag (`v1.2.3` or `some-package@1.2.3`). Commit release: empty.
  const releaseTag = getEnv('RELEASE_TAG')
  const isCommitRelease = !releaseTag
  // The input `package` (commit release only, empty: all packages)
  const selectedPackage = getEnv('SELECTED_PACKAGE')
  if (!isCommitRelease && selectedPackage) {
    fail(
      `The field "Package" (${selectedPackage}) is only for commit releases, but this run re-publishes the stable release ${releaseTag} (the tag selected in "Use workflow from"). To re-publish ${releaseTag}, run the workflow again with an empty "Package" field. To commit-release ${selectedPackage} instead, run it again with ${releaseTag} in the field "Commit to commit-release".`,
    )
  }
  const filesMonorepo = await getFilesInsideDir(monorepoRootDir)
  const packages = getReleaseMePackages(filesMonorepo)

  const toPublish = isCommitRelease
    ? await prepareCommitRelease(packages, selectedPackage)
    : [getTaggedPackage(releaseTag, packages)]
  // Also the workspace packages they depend on, first: this fresh checkout has no build output yet
  for (const packageRootDir of getPackagesToBuild(toPublish, getWorkspacePackages(filesMonorepo))) {
    await build(packageRootDir)
  }
  const published: string[] = []
  for (const pkg of toPublish) {
    published.push(await publish(pkg, isCommitRelease))
  }
  writeSummary(published, isCommitRelease)
}

function getWorkspacePackages(filesMonorepo: Awaited<ReturnType<typeof getFilesInsideDir>>): WorkspacePackage[] {
  return getFilesMonorepoPackageJson(filesMonorepo).map(({ filePathAbsolute }) => {
    const packageRootDir = path.dirname(filePathAbsolute)
    return { packageRootDir, packageJson: getPackageJson(packageRootDir).packageJson }
  })
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

/** Sets the commit release version of the package `packageName` (empty: of all packages), and returns these packages */
async function prepareCommitRelease(packages: ReleaseMePackage[], packageName: string): Promise<ReleaseMePackage[]> {
  const selected = packageName ? packages.filter((p) => p.packageName === packageName) : packages
  if (selected.length === 0) fail(`No package ${packageName} is released by release-me (packages: ${list(packages)}).`)
  const commitHash = await getCommitHash('HEAD')
  // Set all versions first: builds include them (PROJECT_VERSION.ts), and `$ pnpm pack` uses them to replace `workspace:` dependency versions
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
    await npmPublish(packageName, spec, [tarball, ...(packageJson.publishConfig?.tag ? [] : ['--tag', 'latest'])])
  } else {
    // - `$ npm publish` always sets a dist-tag: use the dist-tag `commit` and remove it afterwards.
    // - No provenance: it would point to the commit the workflow run belongs to (the tip of the branch selected in "Use workflow from"), which isn't necessarily the released commit.
    //   (A CLI flag, because package.json#publishConfig.provenance overrides env variables, but not CLI flags.)
    await npmPublish(packageName, spec, [tarball, '--tag', 'commit', '--provenance=false'])
    try {
      npm(['dist-tag', 'rm', packageName, 'commit'])
    } catch {
      const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
      console.log(
        `::warning::Couldn't remove the npm dist-tag commit of ${packageName}: with trusted publishing, it requires npm >= 11.21.0 (this run uses npm ${npmVersion}) and, on npmjs.com, "Allow npm dist-tag" enabled for the trusted publisher ${releaseNpmWorkflowFile.fileName} of ${packageName}.`,
      )
    }
  }
  return spec
}

/** @returns The path of the tarball */
async function pack(packageRootDir: string): Promise<string> {
  // `$ pnpm publish` runs prepublishOnly, whereas `$ pnpm pack` doesn't
  await run('pnpm run --if-present prepublishOnly', { cwd: packageRootDir })
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-me-'))
  // `$ pnpm pack` replaces `workspace:` and `catalog:` dependency versions
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

function npm(args: string[]) {
  console.log(`$ npm ${args.join(' ')}`)
  execFileSync('npm', args, { stdio: 'inherit' })
}

/** `$ npm publish ${args}`, which fails with a helpful message if npm couldn't authenticate the GitHub Action */
async function npmPublish(packageName: string, spec: string, args: string[]) {
  args = ['publish', ...args]
  console.log(`$ npm ${args.join(' ')}`)
  // Shows npm's stderr, and keeps it to read npm's error code
  const subprocess = execa('npm', args, { stdin: 'inherit', stdout: 'inherit', stderr: 'pipe', reject: false })
  subprocess.stderr!.pipe(process.stderr)
  const { failed, stderr } = await subprocess
  if (!failed) return
  // npm has no credentials: its trusted publishing failed (the workflow has the permission `id-token: write`, and no npm token)
  if (/^npm error code ENEEDAUTH$/m.test(stderr)) fail(await getNeedAuthMessage(packageName, spec))
  throw new Error(`Command failed: npm ${args.join(' ')}`)
}

/** Why npm couldn't authenticate the GitHub Action to publish `spec`, and how to fix it */
async function getNeedAuthMessage(packageName: string, spec: string): Promise<string> {
  if (await isMissingOnNpm(packageName)) return `npm can't publish ${spec}, because ${getNotOnNpmReason(packageName)}.`
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env
  // The page of this run, which has the button Re-run jobs
  const runLink =
    GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
      ? pc.underline(`${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`)
      : null
  return [
    `npm couldn't authenticate the GitHub Action ${releaseNpmWorkflowFile.fileName} to publish ${spec} (npm error code ENEEDAUTH): ${packageName} needs a trusted publisher for it. Set it up (or, if ${packageName} already has one, check that it matches):`,
    ...getTrustedPublisherSteps([packageName], GITHUB_REPOSITORY || null),
    `Then ${runLink ? `go to ${runLink} and press` : 'press'} ${pc.bold('Re-run jobs')}.`,
  ].join('\n')
}

function list(packages: ReleaseMePackage[]): string {
  return packages.map((p) => p.packageName).join(', ')
}

function getEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) fail(`The environment variable ${name} is missing.`)
  return value
}
