export { releaseMe }
export { releaseTypes }
export type { CliArgs }
export type { ReleaseType }
export type { ReleaseTarget }
// Used by ./ci/
export { build }
export { getCommitHash }
export { getCommitReleaseVersion }
export { getFilesInsideDir }
export { getMonorepoRootDir }
export { getPackageJson }
export { assertInstalledAtRoot }
export { getReleaseMePackages }
export { updatePackageJsonVersion }
export { updateVersionMacro }
export type { PackageJson }
export type { ReleaseMePackage }

import execa from 'execa'
import * as fs from 'fs'
import assert from 'assert'
import * as semver from 'semver'
import { runCommand, assertUsage, logDetail, logTitle, run, run__return } from './utils.ts'
import { triggerCommitRelease, triggerStableRelease } from './ci/githubAction.ts'
import { publishesViaGitHubAction, releaseWorkflowFileName, releaseWorkflowPath } from './ci/releaseWorkflow.ts'
import * as path from 'path'
/*
//  "js-yaml": "4.1.0",
//  "@types/js-yaml": "4.0.7",
import yaml from 'js-yaml' */
import readline from 'readline'
import pc from '@brillout/picocolors'
import { ConventionalChangelog } from 'conventional-changelog'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const thisPackageName = '@brillout/release-me'
const thisCommand = '$ pnpm exec release-me'

process.on('uncaughtException', clean)
process.on('unhandledRejection', clean)
process.on('SIGINT', clean) // User hitting Ctrl-C https://stackoverflow.com/questions/20165605/detecting-ctrlc-in-node-js/20165643#20165643

const releaseTypes = ['minor', 'patch', 'major', 'commit'] as const
type ReleaseType = (typeof releaseTypes)[number]
type ReleaseTarget = ReleaseType | `v${string}`

type CliArgs = {
  force: boolean
  yes: boolean
  releaseTarget: ReleaseTarget
}
type GitTagPrefix = `v` | `${string}@`
type GitTag = `${GitTagPrefix}${string}`
async function releaseMe(args: CliArgs, packageRootDir: string) {
  // =======
  // Analyse
  // =======

  const monorepoRootDir = await getMonorepoRootDir()
  assertInstalledAtRoot(monorepoRootDir)

  const viaGitHubAction = publishesViaGitHubAction(monorepoRootDir)

  await abortIfUncommitedChanges(monorepoRootDir)

  const { packageName, packageJsonPath } = getPackageName(packageRootDir)

  const commitHashBegin = await getCommitHash('HEAD')

  const { versionOld, versionNew, isCommitRelease } = await getVersion(
    packageRootDir,
    args.releaseTarget,
    commitHashBegin,
  )

  const filesMonorepo = await getFilesInsideDir(monorepoRootDir)
  const filesPackage = await getFilesInsideDir(packageRootDir)

  const monorepoInfo = analyzeMonorepo(filesMonorepo, packageRootDir, packageName)

  logAnalysis(monorepoInfo, monorepoRootDir, packageRootDir, viaGitHubAction)

  if (!isCommitRelease && !args.force) await abortIfNotLatestMainCommit()

  if (isCommitRelease && viaGitHubAction) {
    // The GitHub Action builds & publishes the commit release: there is nothing to do locally.
    await triggerCommitRelease(packageName, versionNew, commitHashBegin)
    return
  }

  // No uncommitted changes => we can safely use `$ git reset` => we can enable cleaning (i.e. reverting the release).
  cleanEnabled = commitHashBegin

  // =============
  // Apply changes
  // =============

  await updateVersionMacro(versionOld, versionNew, filesPackage)

  if (isCommitRelease) {
    updatePackageJsonVersion(packageRootDir, versionNew)
    await build()
    await publishCommitRelease(packageRootDir, packageName)
    await revertChanges()
    return
  }

  // Update pacakge.json versions
  updatePackageJsonVersion(packageRootDir, versionNew)

  await updateDependencies(packageName, versionNew, versionOld, filesMonorepo)

  const gitTagPrefix: GitTagPrefix = monorepoInfo.hasMultiplePackages ? `${packageName}@` : 'v'

  const { changeLogFilePath, changeLogFileAlreadyExisted } = getChangelogPath(
    packageRootDir,
    monorepoRootDir,
    monorepoInfo.hasMultiplePackages,
  )
  const { isMissingChangeLog } = await writeChangeLog(
    changeLogFilePath,
    monorepoInfo.hasMultiplePackages,
    packageRootDir,
    gitTagPrefix,
    packageName,
  )

  await showPreview(packageJsonPath, changeLogFilePath, changeLogFileAlreadyExisted)

  if (isMissingChangeLog && !args.force) {
    assert(changeLogFileAlreadyExisted)
    console.log(
      pc.red(
        `Release aborted — release doesn't have any CHANGELOG.md entry (use ${pc.bold(
          '--force',
        )} to release nevertheless).`,
      ),
    )
    await revertChanges()
    return
  }

  // =================
  // Ask confirmation
  // =================

  if (!args.yes) await askConfirmation()

  // =============================
  // Build
  // =============================

  // With a GitHub Action, the build only checks that the release builds before pushing it (the GitHub Action builds it again).
  await build()

  // =============================
  // npm publish
  // =============================

  // With a GitHub Action, it publishes to npm upon `git push` (see below).
  if (!viaGitHubAction) await npmPublish(packageRootDir)

  // ===================
  // Bump pnpm-lock.yaml
  // ===================

  await bumpPnpmLockFile(monorepoRootDir, viaGitHubAction ? packageName : null)

  // =============================
  // Git commit & push
  // =============================

  const gitTag = getGitTag(versionNew, gitTagPrefix)
  await makeGitCommit(monorepoRootDir, gitTag)
  await makeGitTag(gitTag)
  if (viaGitHubAction) {
    await triggerStableRelease(gitTag, `${packageName}@${versionNew}`)
  } else {
    await gitPush()
  }
}

function getPackageName(packageRootDir: string): { packageName: string; packageJsonPath: string } {
  const hint = `Make sure to run ${pc.bold(
    thisCommand,
  )} at the root directory of the package you want to publish (the directory where its package.json file lives).`
  if (!fs.existsSync(path.join(packageRootDir, 'package.json')))
    throw new Error(
      [
        //
        `No ${pc.bold('package.json')} found at ${packageRootDir} ${logDetail('process.cwd()')}.`,
        hint,
      ].join(' '),
    )
  const { packageJson, packageJsonPath } = getPackageJson(packageRootDir)
  const packageName = packageJson.name
  if (!packageName)
    throw new Error(
      [
        //
        `${packageJsonPath} is missing package.json#${pc.cyan('name')}.`,
        hint,
      ].join(' '),
    )
  return { packageName, packageJsonPath }
}

type PackageJson = {
  name?: string
  version?: string
  private?: boolean
  repository?: string | { url?: string }
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
  devEngines?: { packageManager?: { name?: string } }
  publishConfig?: { tag?: string }
}
function getPackageJson(dir: string): { packageJson: PackageJson; packageJsonPath: string } {
  const { fileJson, filePath } = readJson('package.json', dir)
  const packageJson = fileJson
  const packageJsonPath = filePath
  return { packageJson, packageJsonPath }
}

function readFile(filePathRelative: string, dir: string) {
  const filePathAbsolute = path.join(dir, filePathRelative)
  const fileContent = fs.readFileSync(filePathAbsolute, 'utf8')
  return { fileContent, filePath: filePathAbsolute }
}

function readJson(filePathRelative: string, dir: string) {
  const { fileContent, filePath } = readFile(filePathRelative, dir)
  const fileJson: Record<string, unknown> = JSON.parse(fileContent)
  return { fileJson, filePath }
}
/*
function getPnpmPackages() {
  const pnpmWorkspaceYaml = readYaml('pnpm-workspace.yaml', monorepoRootDir)
  const pnpmPackages = pnpmWorkspaceYaml.packages
  // TODO: resolve globbing:
  // ```yaml
  // packages:
  //   - 'packages/*'
  //   - 'examples/*'
  // ```
  return pnpmPackages
}
function readYaml(filePathRelative: string, dir: string): Record<string, unknown> {
  const { fileContent } = readFile(filePathRelative, dir)
  const fileParsed: Record<string, unknown> = yaml.load(fileContent) as any
  return fileParsed
}
*/

async function publishCommitRelease(packageRootDir: string, packageName: string) {
  await npmPublish(packageRootDir, 'commit')
  await removeNpmTag(packageRootDir, 'commit', packageName)
}
async function npmPublish(dir: string, tag?: string) {
  logTitle('Pnpm publish')
  const env = getNpmFix()
  let cmd = 'pnpm publish --no-git-checks'
  if (tag) {
    cmd = `${cmd} --tag ${tag}`
  }
  await run(cmd, { cwd: dir, env })
}
async function removeNpmTag(dir: string, tag: string, packageName: string) {
  const env = getNpmFix()
  const cmd = `npm dist-tag rm ${packageName} ${tag}`
  const [command, ...args] = cmd.split(' ')
  try {
    // Pipe output (instead of inheriting it) so that a 403 error isn't shown
    await execa(command!, args, { cwd: dir, env, all: true })
  } catch (err) {
    const output = (err as execa.ExecaError).all ?? ''
    if (/\bE403\b|403 Forbidden/.test(output)) {
      // Since August 2026, npm rejects `$ npm dist-tag rm` with `403 Forbidden` when using an access token that bypasses 2FA
      // - https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/
      // - Removing a tag requires an interactive 2FA session (e.g. `$ npm login`)
      // - There is no `$ npm publish` option to publish without a tag, hence why we publish with a tag and remove the tag afterwards
      // - We just log: the version is already published — a lingering tag is harmless (it merely points to the latest commit release)
      console.log(`(No permission to remove the npm tag ${pc.cyan(tag)}.)`)
    } else {
      console.log(pc.bold(pc.blue(`$ ${cmd}`)))
      throw err
    }
  }
}

// Fix for: (see https://github.com/yarnpkg/yarn/issues/2935#issuecomment-487020430)
// > npm ERR! need auth You need to authorize this machine using `npm adduser`
function getNpmFix() {
  return { ...process.env, npm_config_registry: undefined }
}

async function writeChangeLog(
  changeLogFilePath: string,
  hasMultiplePackages: boolean,
  packageRootDir: string,
  gitTagPrefix: GitTagPrefix,
  packageName: string,
) {
  const generator = new ConventionalChangelog()
    //
    .readPackage()
    .loadPreset('angular')
    .tags({
      prefix: gitTagPrefix,
    })

  generator.commits(
    {
      // Filter commits.
      // - Equivalent to CLI argument `--commit-path`.
      // - https://github.com/conventional-changelog/conventional-changelog/issues/556#issuecomment-555539998
      path: !hasMultiplePackages
        ? // Set to `undefined` in order to enable empty release commits (e.g. `fix: `).
          undefined
        : packageRootDir,
    },
    {
      // Skip revert commits.
      // - Modify revertPattern set by node_modules/conventional-changelog-angular/parserOpts.js to skip the default commit message upon `$ git revert`.
      revertPattern: /^revert:\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
    },
  )

  generator.options({
    transformCommit(commit, params) {
      assert(params!.package!.name === packageName)
      const { scope } = commit
      assert(scope === null || scope === undefined || typeof scope === 'string')
      if (scope) {
        if (scope !== packageName) return null
      }
      return { ...commit, scope: null } as any as typeof commit
    },
  })

  let changeLogNewContent = ''
  for await (const chunk of generator.write()) {
    changeLogNewContent += chunk
  }
  if (changeLogNewContent) changeLogNewContent = changeLogNewContent.trim() + '\n\n\n\n'

  const changeLogFileWasEmpty = prependFile(changeLogFilePath, changeLogNewContent)
  /*
  // Usage examples:
  //  - pnpm exec conventional-changelog --preset angular
  //  - pnpm exec conventional-changelog --preset angular --infile CHANGELOG.md --same-file
  //  - pnpm exec conventional-changelog --preset angular --infile CHANGELOG.md --same-file --pkg ./path/to/pkg
  await run(
    [
      'pnpm',
      'exec',
      'conventional-changelog',
      '--preset',
      'angular',
      '--infile',
      changeLogFilePath,
      '--same-file',
      '--pkg',
      packageRootDir
    ],
    { dir: packageRootDir
  )
  */

  const isMissingChangeLog = !changeLogNewContent.includes('*') && !changeLogFileWasEmpty
  return { isMissingChangeLog }
}

function prependFile(filePath: string, str: string) {
  let content = ''
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {}
  const fileWasEmtpy = content.trim() === ''
  content = str + content
  content = content.trim() + '\n'
  fs.writeFileSync(filePath, content)
  return fileWasEmtpy
}

const changlogFileName = 'CHANGELOG.md'
function getChangelogPath(packageRootDir: string, monorepoRootDir: string, hasMultiplePackages: boolean) {
  assert(path.isAbsolute(packageRootDir))
  assert(path.isAbsolute(monorepoRootDir))
  const packageChangelogPath = path.join(packageRootDir, changlogFileName)
  const monorepoChangelogPath = path.join(monorepoRootDir, changlogFileName)
  const changeLogFilePath =
    hasMultiplePackages || fs.existsSync(packageChangelogPath) || !fs.existsSync(monorepoChangelogPath)
      ? packageChangelogPath
      : monorepoChangelogPath
  const changeLogFileAlreadyExisted = fs.existsSync(changeLogFilePath)
  return { changeLogFilePath, changeLogFileAlreadyExisted }
}

async function showPreview(packageJsonPath: string, changeLogFilePath: string, changeLogFileAlreadyExisted: boolean) {
  logTitle('Confirm changes')
  await logCmd('git status')
  await logDiff(changeLogFilePath, changeLogFileAlreadyExisted)
  await logDiff(packageJsonPath, true)

  return

  async function logDiff(filePath: string, fileAlreadyExists: boolean) {
    const cmdReal = fileAlreadyExists
      ? `git --no-pager diff ${filePath}`
      : // https://stackoverflow.com/questions/855767/can-i-use-git-diff-on-untracked-files#comment35922182_856118
        `git --no-pager diff --no-index -- /dev/null ${filePath}`
    await logCmd(`git diff ${filePath}`, cmdReal, true)
  }

  async function logCmd(cmd: string, cmdReal?: string, swallowError?: boolean) {
    cmdReal ??= cmd
    console.log(pc.bold(pc.blue(`$ ${cmd}`)))
    await run(cmdReal, { swallowError })
    console.log()
  }
}

function askConfirmation(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let resolve: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  rl.question(pc.blue(pc.bold('Press <ENTER> to confirm release, or <CTRL-C> to abort.')), () => {
    resolve()
    rl.close()
  })
  rl.on('SIGINT', clean) // https://github.com/nodejs/node/issues/4758#issuecomment-231155557
  return promise
}

async function makeGitCommit(monorepoRootDir: string, gitTag: GitTag) {
  logTitle('Git commit')
  await run('git add .', { cwd: monorepoRootDir })
  await run(['git', 'commit', '-am', `release: ${gitTag}`])
}
async function makeGitTag(gitTag: GitTag) {
  await run(`git tag ${gitTag}`)
  cleanTag = gitTag
}
function getGitTag(versionNew: string, gitTagPrefix: GitTagPrefix): GitTag {
  const gitTag = `${gitTagPrefix}${versionNew}` as const
  return gitTag
}
async function gitPush() {
  logTitle('Git push')
  await run('git push')
  await run('git push --tags')
}
async function build(cwd?: string) {
  logTitle(`Build ${logDetail('$ pnpm run build')}`)
  await run('pnpm run build', { cwd })
}

async function getVersion(
  packageRootDir: string,
  releaseTarget: ReleaseTarget,
  commitHashBegin: string,
): Promise<{ versionNew: string; versionOld: string; isCommitRelease: boolean }> {
  const packageJson = require(`${packageRootDir}/package.json`) as PackageJson
  const versionOld = packageJson.version
  assert(versionOld)
  let isCommitRelease = false
  let versionNew: string
  if (releaseTarget === 'commit') {
    versionNew = getCommitReleaseVersion(versionOld, commitHashBegin)
    isCommitRelease = true
  } else if (releaseTarget === 'patch' || releaseTarget === 'minor' || releaseTarget === 'major') {
    versionNew = semver.inc(versionOld, releaseTarget) as string
  } else {
    assert(releaseTarget.startsWith('v'))
    versionNew = releaseTarget.slice(1)
  }
  return { versionNew, versionOld, isCommitRelease }
}
/** `1.2.3` => `1.2.3-commit-1234567`: a pre-release version, so that semver ranges such as `^1.2.3` never match it */
function getCommitReleaseVersion(version: string, commitHash: string): string {
  // Align with GitHub: GitHub (always?) picks the first 7 characters.
  return `${version}-commit-${commitHash.slice(0, 7)}`
}
async function updateVersionMacro(versionOld: string, versionNew: string, filesPackage: Files) {
  filesPackage
    .filter((f) => f.filePathAbsolute.endsWith(`/PROJECT_VERSION.ts`))
    .forEach(({ filePathAbsolute }) => {
      assert(path.isAbsolute(filePathAbsolute))
      const getCodeSnippet = (version: string) => `const PROJECT_VERSION = '${version}'`
      const codeSnippetOld = getCodeSnippet(versionOld)
      const codeSnippetNew = getCodeSnippet(versionNew)
      const contentOld = fs.readFileSync(filePathAbsolute, 'utf8')
      assertUsage(
        contentOld.includes(codeSnippetOld),
        [
          `${filePathAbsolute} is expected to contain ${pc.code(codeSnippetOld)} —`,
          `make sure it contains this string, or rename the file.`,
        ].join(' '),
      )
      /*
      if (!contentOld.includes(codeSnippetOld)) {
        assert(DEV_MODE)
        return
      }
      */
      const contentNew = contentOld.replace(codeSnippetOld, codeSnippetNew)
      assert(versionOld !== versionNew)
      assert(contentNew !== contentOld)
      fs.writeFileSync(filePathAbsolute, contentNew)
    })
}
function updatePackageJsonVersion(packageRootDir: string, versionNew: string) {
  modifyPackageJson(`${packageRootDir}/package.json`, (pkg) => {
    pkg.version = versionNew
  })
}

function getFilesMonorepoPackageJson(filesMonorepo: Files): Files {
  const filesMonorepoPackageJson = filesMonorepo.filter((f) => f.filePathAbsolute.endsWith('/package.json'))
  return filesMonorepoPackageJson
}

/** @param ciPackageName The released package, if it's published by the GitHub Action (i.e. after the push) */
async function bumpPnpmLockFile(monorepoRootDir: string, ciPackageName: string | null) {
  logTitle('Bump pnpm-lock.yaml')
  try {
    await run(
      [
        'pnpm install',
        // Only update pnpm-lock.yaml (which is what we commit) and leave node_modules untouched:
        // - A full `$ pnpm install` may show an interactive prompt (e.g. `The modules directory at "..." will be removed and reinstalled from scratch. Proceed?`) which stalls the release right after the npm package was published.
        // - There is no pnpm setting to skip that prompt (`--force` skips it but it also forces a full reinstall).
        // - `--lockfile-only` skips the node_modules validation altogether, and it's also faster (nothing is downloaded, no lifecycle script is run).
        '--lockfile-only',
      ].join(' '),
      { cwd: monorepoRootDir, timeout: 10 * 60 * 1000 },
    )
  } catch (err) {
    if (!(err as Error).message.includes('ERR_PNPM_PEER_DEP_ISSUES')) {
      if (ciPackageName) {
        // Unlike when publishing locally, the new version isn't on npm yet
        console.log(
          pc.yellow(
            `Hint: the new version of ${ciPackageName} isn't on npm yet (the GitHub Action publishes it after the release is pushed), so the packages of the monorepo that depend on ${ciPackageName} must get it from the workspace (with the ${pc.bold(
              'workspace:',
            )} protocol, or with the pnpm setting ${pc.bold('link-workspace-packages')}).`,
          ),
        )
      }
      throw err
    }
  }
}

type Files = {
  filePathRelative: string
  filePathAbsolute: string
}[]
async function getFilesInsideDir(dir: string): Promise<Files> {
  const stdout = await run__return('git ls-files', dir)
  let filesPathRelative = stdout.split(/\s/)
  const files = filesPathRelative.map((filePathRelative) => {
    assert(!filePathRelative.startsWith('/'))
    assert(!filePathRelative.includes('\\'))
    const filePathAbsolute = path.posix.join(dir, filePathRelative)
    assert(!filePathAbsolute.includes('\\'))
    return {
      filePathRelative,
      filePathAbsolute,
    }
  })
  return files
}

async function revertChanges() {
  // The value of `cleanEnabled` is the commit hash before we applied changes.
  assert(typeof cleanEnabled === 'string')
  const commitHashBegin = cleanEnabled
  const commitHashNow = await getCommitHash('HEAD')

  const hasUncommittedChanges = await repoHasUncommittedChanges()
  if (!hasUncommittedChanges && commitHashBegin === commitHashNow) return
  logTitle('Revert changes')

  if (hasUncommittedChanges) {
    await run(`git add ${cleanRootDir}`)
    await run(['git', 'commit', '-am', 'reverted release commit'])
  }

  if (cleanTag) {
    assert(typeof cleanTag === 'string')
    const gitTag: GitTag = cleanTag
    await run(`git tag -d ${gitTag}`)
  }

  await run(`git reset --hard ${commitHashBegin}`)
}

async function updateDependencies(packageName: string, versionNew: string, versionOld: string, filesMonorepo: Files) {
  filesMonorepo
    .filter((f) => f.filePathAbsolute.endsWith('package.json'))
    .forEach(({ filePathAbsolute }) => {
      modifyPackageJson(filePathAbsolute, (packageJson) => {
        let hasChanged = false
        ;(['dependencies', 'devDependencies'] as const).forEach((deps) => {
          const version = packageJson[deps]?.[packageName]
          if (!version) {
            return
          }
          hasChanged = true
          const hasRange = version.startsWith('^')
          const versionOld_range = !hasRange ? versionOld : `^${versionOld}`
          const versionNew_range = !hasRange ? versionNew : `^${versionNew}`
          if (!version.startsWith('link:') && !version.startsWith('workspace:')) {
            try {
              assert.strictEqual(version, versionOld_range)
            } catch (err) {
              assertUsage(false, `Wrong ${packageName} version in ${filePathAbsolute} — ${(err as Error).message}`)
            }
            packageJson[deps]![packageName] = versionNew_range
          }
        })
        if (!hasChanged) {
          return 'SKIP'
        }
      })
    })
}

function modifyPackageJson(pkgPath: string, updater: (pkg: PackageJson) => void | 'SKIP') {
  const pkg = require(pkgPath) as PackageJson
  const skip = updater(pkg)
  if (skip === 'SKIP') {
    return
  }
  writePackageJson(pkgPath, pkg)
}

function writePackageJson(pkgPath: string, pkg: object) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

async function abortIfUncommitedChanges(monorepoRootDir: string) {
  if (await repoHasUncommittedChanges()) {
    throw new Error(
      pc.red(
        pc.bold(
          `Release aborted, because the Git repository (${monorepoRootDir}) has uncommitted changes. Commit all changes before releasing a new version.`,
        ),
      ),
    )
  }
}
async function repoHasUncommittedChanges() {
  const stdout = await run__return(`git status --porcelain`)
  const hasUncommittedChanges = stdout !== ''
  return hasUncommittedChanges
}

async function abortIfNotLatestMainCommit() {
  // Branch is main
  {
    const stdout = await getBranchName()
    const branch = stdout.trim()
    if ('main' !== branch) {
      throw new Error(
        pc.red(
          pc.bold(
            [
              `Release aborted, because the current branch is ${pc.cyan(branch)}`,
              `but it should be ${pc.cyan('main')} instead.`,
              `Make sure the current branch is ${pc.cyan('main')},`,
              `or use ${pc.cyan('--force')} to skip this check.`,
            ].join(' '),
          ),
        ),
      )
    }
  }

  // HEAD is origin/main
  {
    await runCommand('git fetch', {
      // When `$ git fetch` fetches something, it prints information to stderr instead of stdout (I don't know why).
      // An alternative would to use the --quiet argument.
      // https://stackoverflow.com/questions/57016157/how-to-stop-git-from-writing-non-errors-to-stderr
      swallowError: true,
    })

    const commitHash = await getCommitHash('HEAD')
    const commitHashOriginMain = await getCommitHash('origin/main')
    if (commitHashOriginMain !== commitHash) {
      throw new Error(
        pc.red(
          pc.bold(
            [
              `Release aborted, because ${pc.cyan('HEAD')}`,
              `isn't up-to-date with ${pc.cyan('origin/main')}.`,
              `Make sure to push/pull all changes, or use ${pc.cyan('--force')} to skip this check.`,
            ].join(' '),
          ),
        ),
      )
    } else {
      const stdout = await run__return(`git status`)
      // Is this assert() too sensitive? Do we really need it? Should we remove it?
      assert(
        stdout.trim() ===
          `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean`,
      )
    }
  }
}

async function getCommitHash(commit: 'HEAD' | 'origin/main') {
  const commitHash = (await run__return(`git rev-parse ${commit}`)).trim()
  assert(commitHash)
  return commitHash
}

async function getBranchName() {
  // https://stackoverflow.com/questions/1417957/show-just-the-current-branch-in-git/1418022#1418022
  const branchName = (await run__return('git rev-parse --abbrev-ref HEAD')).trim()
  return branchName
}

function isSamePath(p1: string, p2: string) {
  assert(path.isAbsolute(p1))
  assert(path.isAbsolute(p2))
  p1 = path.normalize(p1)
  p2 = path.normalize(p2)
  assert(!p1.includes('\\'))
  assert(!p2.includes('\\'))
  assert(p1.startsWith('/'))
  assert(p2.startsWith('/'))
  assert(!p1.endsWith('/'))
  assert(!p2.endsWith('/'))
  return p1 === p2
}

const gitCmdMonorepoRootDir = 'git rev-parse --show-toplevel'
async function getMonorepoRootDir() {
  const monorepoRootDir = (await run__return(gitCmdMonorepoRootDir)).trim()
  cleanRootDir = monorepoRootDir
  return monorepoRootDir
}

function logAnalysis(
  monorepoInfo: MonorepoInfo,
  monorepoRootDir: string,
  packageRootDir: string,
  viaGitHubAction: boolean,
) {
  logTitle('Analysis result', true)
  console.log(`Package root directory: ${pc.bold(packageRootDir)} ${logDetail('process.cwd()')}`)
  console.log(
    `Publish to npm: ${
      viaGitHubAction
        ? `GitHub Action ${pc.bold(releaseWorkflowFileName)} ${logDetail(releaseWorkflowPath)}`
        : `locally ${logDetail('$ pnpm publish')}`
    }`,
  )
  const isMonorepo = !isSamePath(packageRootDir, monorepoRootDir) || monorepoInfo.hasMultiplePackages
  console.log(`Monorepo: ${logBoolean(isMonorepo)}`)
  if (isMonorepo) {
    console.log(`Monorepo root directory: ${pc.bold(monorepoRootDir)} ${logDetail(`$ ${gitCmdMonorepoRootDir}`)}`)
    console.log(`Has multiple packges: ${logBoolean(monorepoInfo.hasMultiplePackages)}`)
    console.log('Packages:')
    monorepoInfo.monorepoPackages.forEach((monorepoPkg) => {
      let line = `- ${pc.bold(monorepoPkg.packageName)} (${monorepoPkg.packageRootDirRelative})`
      if (monorepoPkg.isCurrentPackage) line = pc.cyan(line)
      console.log(line)
    })
  }
}

let cleanRootDir = process.cwd()
let cleanEnabled: false | string = false
let isCleaning = false
let cleanTag: false | GitTag = false
async function clean(err: unknown) {
  if (err) {
    logTitle('Error')
    console.error(err)
  }
  if (cleanEnabled && !isCleaning) {
    isCleaning = true
    // No guarentee that Node.js awaits this async function.
    // https://stackoverflow.com/questions/40574218/how-to-perform-an-async-operation-on-exit
    await revertChanges()
  }
  process.exit(1)
}

type MonorepoInfo = ReturnType<typeof analyzeMonorepo>
function analyzeMonorepo(filesMonorepo: Files, packageRootDir: string, packageName: string) {
  const monorepoPackages = getReleaseMePackages(filesMonorepo).map((pkg) => ({
    ...pkg,
    isCurrentPackage: isSamePath(packageRootDir, pkg.packageRootDir),
  }))
  const currentPackages = monorepoPackages.filter((pkg) => pkg.isCurrentPackage)
  assertUsage(
    currentPackages.length === 1,
    `${pc.cyan(packageName)} isn't released by release-me: add a script that runs release-me to ${path.join(
      packageRootDir,
      'package.json',
    )} (e.g. ${pc.bold('"release": "release-me patch"')}).`,
  )
  assert(currentPackages[0]!.packageName === packageName)
  return {
    hasMultiplePackages: monorepoPackages.length > 1,
    monorepoPackages,
  }
}

/** release-me must be in the devDependencies of the root package.json (e.g. the GitHub Action runs it from there) */
function assertInstalledAtRoot(monorepoRootDir: string) {
  const packageJsonPath = path.join(monorepoRootDir, 'package.json')
  const isInstalled =
    fs.existsSync(packageJsonPath) && !!getPackageJson(monorepoRootDir).packageJson.devDependencies?.[thisPackageName]
  assertUsage(
    isInstalled,
    `${pc.cyan(thisPackageName)} should be installed at the root: add it to the devDependencies of ${packageJsonPath}.`,
  )
}

type ReleaseMePackage = ReturnType<typeof getReleaseMePackages>[number]
/**
 * The packages that release-me releases: the ones with a script that runs release-me (e.g. `"release": "release-me patch"`), except private ones.
 * If no package has such script: the root package (e.g. a repository with a single package, released with `$ pnpm exec release-me patch`).
 */
function getReleaseMePackages(filesMonorepo: Files) {
  const packages: { packageName: string; packageRootDir: string; packageRootDirRelative: string }[] = []
  let rootPackage: (typeof packages)[number] | null = null
  for (const { filePathAbsolute, filePathRelative } of getFilesMonorepoPackageJson(filesMonorepo)) {
    const packageRootDir = path.dirname(filePathAbsolute)
    const { packageJson } = getPackageJson(packageRootDir)
    assertUsage(
      !packageJson.dependencies?.[thisPackageName],
      `${pc.cyan('@brillout/release-me')} shouldn't be inside ${pc.gray(packageRootDir)}/package.json#${pc.bold(
        'dependencies',
      )} as it should be only in package.json#${pc.bold('devDependencies')} instead.`,
    )
    if (!packageJson.name || packageJson.private) continue
    const pkg = {
      packageName: packageJson.name,
      packageRootDir,
      packageRootDirRelative: path.dirname(filePathRelative),
    }
    if (hasReleaseScript(packageJson)) packages.push(pkg)
    else if (pkg.packageRootDirRelative === '.') rootPackage = pkg
  }
  if (packages.length === 0 && rootPackage) packages.push(rootPackage)
  assertUsage(
    packages.length > 0,
    `No package to release: add a script that runs release-me to the package.json of each package to release (e.g. ${pc.bold(
      '"release": "release-me patch"',
    )}).`,
  )
  return packages
}
/** Whether one of the scripts runs release-me, e.g. `"release": "release-me patch"` */
function hasReleaseScript(packageJson: PackageJson): boolean {
  return Object.values(packageJson.scripts ?? {}).some(
    (script) => typeof script === 'string' && script.split(/[\s;&|()]+/).includes('release-me'),
  )
}

function logBoolean(bool: boolean): 'yes' | 'no' {
  return pc.bold(bool ? 'yes' : 'no')
}
