export { releaseMe }
export { releaseTypes }
export type { CliArgs }
export type { ReleaseType }
export type { ReleaseTarget }

import execa from 'execa'
import * as fs from 'fs'
import assert from 'assert'
import * as semver from 'semver'
import { runCommand, assertUsage } from './utils.js'
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
  const filesMonorepoPackageJson = getFilesMonorepoPackageJson(filesMonorepo)

  const monorepoInfo = analyzeMonorepo(filesMonorepoPackageJson, packageRootDir, packageName)

  logAnalysis(monorepoInfo, monorepoRootDir, packageRootDir)

  if (!isCommitRelease && !args.force) await abortIfNotLatestMainCommit()

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
  const boilerplatePackageJson = await findBoilerplatePacakge(packageName, filesMonorepoPackageJson)
  if (boilerplatePackageJson) {
    bumpBoilerplateVersion(boilerplatePackageJson)
  }

  const gitTagPrefix: GitTagPrefix = monorepoInfo.hasMultiplePackages ? `${packageName}@` : 'v'

  const { changelogPath, changelogAlreadyExists } = getChangelogPath(
    monorepoInfo.hasMultiplePackages ? packageRootDir : monorepoRootDir,
  )
  const { isMissingChangeLog } = await writeChangeLog(
    changelogPath,
    monorepoInfo.hasMultiplePackages,
    packageRootDir,
    gitTagPrefix,
    packageName,
  )

  await showPreview(packageJsonPath, changelogPath, changelogAlreadyExists)

  if (isMissingChangeLog && !args.force) {
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

  // ===================
  // Bump pnpm-lock.yaml
  // ===================

  await bumpPnpmLockFile(monorepoRootDir)

  // =============================
  // Commit, npm publish, git push
  // =============================

  const gitTag = getGitTag(versionNew, gitTagPrefix)
  await makeGitCommit(monorepoRootDir, gitTag)
  await makeGitTag(gitTag)

  await build()

  await npmPublish(packageRootDir)
  if (boilerplatePackageJson) {
    await publishBoilerplates(boilerplatePackageJson)
  }

  await gitPush()
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
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
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
async function publishBoilerplates(boilerplatePackageJson: string) {
  await npmPublish(path.dirname(boilerplatePackageJson))
}
async function npmPublish(dir: string, tag?: string) {
  logTitle('Pnpm publish')
  const env = getNpmFix()
  let cmd = 'pnpm publish --no-git-checks'
  if (tag) {
    cmd = `${cmd} --tag ${tag}`
  }
  await run(cmd, { dir, env })
}
async function removeNpmTag(dir: string, tag: string, packageName: string) {
  const env = getNpmFix()
  await run(`npm dist-tag rm ${packageName} ${tag}`, { dir, env })
}

// Fix for: (see https://github.com/yarnpkg/yarn/issues/2935#issuecomment-487020430)
// > npm ERR! need auth You need to authorize this machine using `npm adduser`
function getNpmFix() {
  return { ...process.env, npm_config_registry: undefined }
}

async function writeChangeLog(
  changelogPath: string,
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
  const changeLogWasEmpty = prependFile(changelogPath, changeLogNewContent)
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
      changelogPath,
      '--same-file',
      '--pkg',
      packageRootDir
    ],
    { dir: packageRootDir
  )
  */

  const isMissingChangeLog = !changeLogNewContent.includes('*') && !changeLogWasEmpty
  return { isMissingChangeLog }
}

function prependFile(filePath: string, str: string) {
  let content = ''
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {}
  const fileWasEmtpy = content.trim() === ''
  content = str + content
  fs.writeFileSync(filePath, content)
  return fileWasEmtpy
}

const changlogFileName = 'CHANGELOG.md'
function getChangelogPath(packageRootDir: string) {
  const changelogPath = path.join(packageRootDir, changlogFileName)
  const changelogAlreadyExists = fs.existsSync(changelogPath)
  return { changelogPath, changelogAlreadyExists }
}

async function showPreview(packageJsonPath: string, changelogPath: string, changelogAlreadyExists: boolean) {
  logTitle('Confirm changes')
  await logCmd('git status')
  await logDiff(changelogPath, changelogAlreadyExists)
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
  await run('git add .', { dir: monorepoRootDir })
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
async function build() {
  logTitle(`Build ${logDetail('$ pnpm run build')}`)
  await run('pnpm run build')
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
    // Align with GitHub: GitHub (always?) picks the first 7 characters.
    const hash = commitHashBegin.slice(0, 7)
    versionNew = `${versionOld}-commit-${hash}`
    isCommitRelease = true
  } else if (releaseTarget === 'patch' || releaseTarget === 'minor' || releaseTarget === 'major') {
    versionNew = semver.inc(versionOld, releaseTarget) as string
  } else {
    assert(releaseTarget.startsWith('v'))
    versionNew = releaseTarget.slice(1)
  }
  return { versionNew, versionOld, isCommitRelease }
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

async function bumpBoilerplateVersion(packageJsonFile: string) {
  assert(path.isAbsolute(packageJsonFile))
  const packageJson = require(packageJsonFile)
  assert(packageJson.version.startsWith('0.0.'))
  const versionParts = packageJson.version.split('.')
  assert(versionParts.length === 3)
  const newPatch = parseInt(versionParts[2], 10) + 1
  packageJson.version = `0.0.${newPatch}`
  writePackageJson(packageJsonFile, packageJson)
}

function getFilesMonorepoPackageJson(filesMonorepo: Files): Files {
  const filesMonorepoPackageJson = filesMonorepo.filter((f) => f.filePathAbsolute.endsWith('/package.json'))
  return filesMonorepoPackageJson
}

async function findBoilerplatePacakge(packageName: string, filesMonorepoPackageJson: Files) {
  for (const { filePathAbsolute } of filesMonorepoPackageJson) {
    const packageJson = require(filePathAbsolute) as Record<string, unknown>
    const { name } = packageJson
    if (!name) continue
    assert(typeof name === 'string')
    if (name === `create-${packageName}`) {
      return filePathAbsolute
    }
  }
  return null
}

async function bumpPnpmLockFile(monorepoRootDir: string) {
  try {
    await runCommand('pnpm install', { cwd: monorepoRootDir, timeout: 10 * 60 * 1000 })
  } catch (err) {
    if (!(err as Error).message.includes('ERR_PNPM_PEER_DEP_ISSUES')) {
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
              console.log(`Wrong ${packageName} version in ${filePathAbsolute}`)
              throw err
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

async function run(
  cmd: string | string[],
  { dir, env = process.env, swallowError }: { dir?: string; env?: NodeJS.ProcessEnv; swallowError?: boolean } = {},
) {
  const stdio = 'inherit'
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  try {
    await execa(command!, args, { cwd: dir, stdio, env })
  } catch (err) {
    if (!swallowError) throw err
  }
}
async function run__return(cmd: string | string[], dir?: string): Promise<string> {
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  const { stdout } = await execa(command!, args, { cwd: dir })
  return stdout
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

function logAnalysis(monorepoInfo: MonorepoInfo, monorepoRootDir: string, packageRootDir: string) {
  logTitle('Analysis result', true)
  console.log(`Package root directory: ${pc.bold(packageRootDir)} ${logDetail('process.cwd()')}`)
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

function logTitle(title: string, noMargin?: true) {
  const titleLine = `==== ${title} ====`
  const titleLength = pc.rm(titleLine).length
  const borderLine = '='.repeat(titleLength)
  let lines = [borderLine, titleLine, borderLine]
  if (!noMargin) lines = ['', '', ...lines]
  console.log(lines.join('\n'))
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
function analyzeMonorepo(filesMonorepoPackageJson: Files, packageRootDir: string, packageName: string) {
  let currentPackageFound = false
  const monorepoPackages: {
    packageName: string
    packageRootDirRelative: string
    isCurrentPackage: boolean
  }[] = []
  filesMonorepoPackageJson.forEach((packageJsonFile) => {
    const packageJsonDir = path.dirname(packageJsonFile.filePathAbsolute)
    const { packageJson } = getPackageJson(packageJsonDir)
    assertUsage(
      !packageJson.dependencies?.[thisPackageName],
      `${pc.cyan('@brillout/release-me')} shouldn't be inside ${pc.gray(packageJsonDir)}/package.json#${pc.bold(
        'dependencies',
      )} as it should be only in package.json#${pc.bold('devDependencies')} instead.`,
    )
    if (!packageJson?.name || !packageJson.devDependencies?.[thisPackageName]) return
    const isCurrentPackage = isSamePath(packageRootDir, packageJsonDir)
    if (isCurrentPackage) {
      assert(!currentPackageFound)
      currentPackageFound = true
      assert(packageJson.name === packageName)
    }
    monorepoPackages.push({
      packageName: packageJson.name,
      packageRootDirRelative: path.dirname(packageJsonFile.filePathRelative),
      isCurrentPackage,
    })
  })

  assert(currentPackageFound)
  return {
    hasMultiplePackages: monorepoPackages.length > 1,
    monorepoPackages,
  }
}

function logDetail(msg: string): string {
  return `(${pc.dim(msg)})`
}
function logBoolean(bool: boolean): 'yes' | 'no' {
  return pc.bold(bool ? 'yes' : 'no')
}
