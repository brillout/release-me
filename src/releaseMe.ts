export { releaseMe }
export { releaseTypes }
export type { Args }
export type { ReleaseType }
export type { ReleaseTarget }

import execa from 'execa'
import * as fs from 'fs'
import assert from 'assert'
import * as semver from 'semver'
import { runCommand } from './utils'
import * as path from 'path'
import yaml from 'js-yaml'
import readline from 'readline'
import pc from 'picocolors'
import conventionalChangelog from 'conventional-changelog'

const thisPackageName = '@brillout/release-me'

process.on('uncaughtException', clean)
process.on('unhandledRejection', clean)
process.on('SIGINT', clean) // User hitting Ctrl-C https://stackoverflow.com/questions/20165605/detecting-ctrlc-in-node-js/20165643#20165643

const releaseTypes = ['minor', 'patch', 'major', 'commit'] as const
type ReleaseType = (typeof releaseTypes)[number]
type ReleaseTarget = ReleaseType | `v${string}`

type Args = {
  force: boolean
  releaseTarget: ReleaseTarget
}
async function releaseMe(args: Args, packageRootDir: string) {
  const monorepoRootDir = await getMonorepoRootDir()

  await abortIfUncommitedChanges(monorepoRootDir)

  const filesPackage = await getFilesInsideDir(packageRootDir)
  const pkg = await getPackage(packageRootDir, filesPackage)

  const { versionOld, versionNew, isCommitRelease } = await getVersion(pkg, args.releaseTarget)

  if (!isCommitRelease && !args.force) {
    await abortIfNotLatestMainCommit()
  }

  const filesMonorepo = await getFilesInsideDir(monorepoRootDir)

  const monorepoInfo = analyzeMonorepo(monorepoRootDir, filesMonorepo, packageRootDir, pkg)

  logAnalysis(monorepoInfo, monorepoRootDir, packageRootDir)

  await updateVersionMacro(versionOld, versionNew, filesMonorepo)

  if (isCommitRelease) {
    updatePackageJsonVersion(pkg, versionNew)
    await build()
    await publishCommitRelease(packageRootDir, pkg)
    await undoChanges()
    return
  }

  // Update pacakge.json versions
  updatePackageJsonVersion(pkg, versionNew)

  await updateDependencies(pkg, versionNew, versionOld, filesMonorepo)
  const boilerplatePackageJson = await findBoilerplatePacakge(pkg, filesMonorepo)
  if (boilerplatePackageJson) {
    bumpBoilerplateVersion(boilerplatePackageJson)
  }

  const gitTagPrefix = monorepoInfo.isMonorepo ? `${pkg.packageName}@` : 'v'

  await changelog(monorepoRootDir, packageRootDir, gitTagPrefix)

  await showPreview(pkg, packageRootDir, filesPackage)
  await askConfirmation()

  await bumpPnpmLockFile(monorepoRootDir)

  await gitCommit(versionNew, monorepoRootDir, gitTagPrefix)

  await build()

  await npmPublish(packageRootDir)
  if (boilerplatePackageJson) {
    await publishBoilerplates(boilerplatePackageJson)
  }

  await gitPush()
}

async function getPackage(packageRootDir: string, filesPackage: Files) {
  // package.json#name
  if (filesPackage.find((f) => f.filePathRelative === 'package.json')) {
    const pkg = readPkg(packageRootDir)
    if (pkg) {
      return pkg
    }
  }

  throw new Error(pc.red(pc.bold(`No package.json found at ${packageRootDir}`)))
}

type Pkg = {
  packageName: string
  packageDir: string
  devDependencies: Record<string, string>
}
function readPkg(dir: string): null | Pkg {
  const { packageJson, packageJsonFile } = readJson('package.json', dir)
  const { name } = packageJson
  if (!name) {
    return null
  }
  const packageDir = path.dirname(packageJsonFile)
  assert(typeof name === 'string')
  const devDependencies = packageJson.devDependencies as Record<string, string>
  return { packageName: name, packageDir, devDependencies }
}

function readFile(filePathRelative: string, dir: string) {
  const filePathAbsolute = path.join(dir, filePathRelative)
  const fileContent = fs.readFileSync(filePathAbsolute, 'utf8')
  return { fileContent, filePath: filePathAbsolute }
}

function readJson(filePathRelative: string, dir: string) {
  const { fileContent, filePath } = readFile(filePathRelative, dir)
  const fileParsed: Record<string, unknown> = JSON.parse(fileContent)
  return { packageJson: fileParsed, packageJsonFile: filePath }
}
function readYaml(filePathRelative: string, dir: string): Record<string, unknown> {
  const { fileContent } = readFile(filePathRelative, dir)
  const fileParsed: Record<string, unknown> = yaml.load(fileContent) as any
  return fileParsed
}

async function publishCommitRelease(packageRootDir: string, pkg: { packageName: string }) {
  await npmPublish(packageRootDir, 'commit')
  await removeNpmTag(packageRootDir, 'commit', pkg.packageName)
}
async function publishBoilerplates(boilerplatePackageJson: string) {
  await npmPublish(path.dirname(boilerplatePackageJson))
}
async function npmPublish(dir: string, tag?: string) {
  const env = getNpmFix()
  let cmd = 'npm publish'
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

async function changelog(monorepoRootDir: string, packageRootDir: string, gitTagPrefix: string) {
  const readable = conventionalChangelog(
    {
      preset: 'angular',
      tagPrefix: gitTagPrefix,
    },
    undefined,
    {
      // Filter commits.
      // - Equivalent to CLI argument `--commit-path`.
      // - https://github.com/conventional-changelog/conventional-changelog/issues/556#issuecomment-555539998
      path: isSamePath(monorepoRootDir, packageRootDir)
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
  const changelog = await streamToString(readable)
  prerendFile(getChangeLogPath(packageRootDir), changelog)
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
      getChangeLogPath(),
      '--same-file',
      '--pkg',
      packageRootDir
    ],
    { dir: packageRootDir
  )
  */
}

function streamToString(readable: ReturnType<typeof conventionalChangelog>): Promise<string> {
  let data = ''
  readable.on('data', (chunk) => (data += chunk))

  let resolve: (data: string) => void
  const promise = new Promise<string>((r) => (resolve = r))
  readable.on('end', () => {
    resolve(data)
  })

  return promise
}

function prerendFile(filePath: string, prerendString: string) {
  let content = ''
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {}
  content = prerendString + content
  fs.writeFileSync(filePath, content)
}

const changlogFileName = 'CHANGELOG.md'
function getChangeLogPath(packageRootDir: string) {
  return path.join(packageRootDir, changlogFileName)
}

async function showPreview(pkg: { packageDir: string }, packageRootDir: string, filesPackage: Files) {
  logTitle('Confirm changes')
  await showCmd('git status')
  await diffAndLog(getChangeLogPath(packageRootDir), true)
  await diffAndLog(path.join(pkg.packageDir, 'package.json'))

  return

  async function diffAndLog(filePath: string, isChangelog?: true) {
    const fileAlreadyExists = (() => {
      if (!isChangelog) return true
      assert(filePath.endsWith(changlogFileName))
      return !!filesPackage.find((f) => f.filePathRelative === changlogFileName)
    })()
    const cmdReal = fileAlreadyExists
      ? `git --no-pager diff ${filePath}`
      : // https://stackoverflow.com/questions/855767/can-i-use-git-diff-on-untracked-files#comment35922182_856118
        `git diff --no-index -- /dev/null ${filePath}`
    await showCmd(`git diff ${filePath}`, cmdReal, fileAlreadyExists)
  }

  async function showCmd(cmd: string, cmdReal?: string, swallowError?: boolean) {
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

async function gitCommit(versionNew: string, monorepoRootDir: string, gitTagPrefix: string) {
  const tag = `${gitTagPrefix}${versionNew}`
  await run('git add .', { dir: monorepoRootDir })
  await run(['git', 'commit', '-am', `release: ${tag}`])
  await run(`git tag ${tag}`)
}
async function gitPush() {
  await run('git push')
  await run('git push --tags')
}
async function build() {
  await run('pnpm run build')
}

async function getVersion(
  pkg: { packageDir: string },
  releaseTarget: ReleaseTarget,
): Promise<{ versionNew: string; versionOld: string; isCommitRelease: boolean }> {
  const packageJson = require(`${pkg.packageDir}/package.json`) as PackageJson
  const versionOld = packageJson.version
  assert(versionOld)
  let isCommitRelease = false
  let versionNew: string
  if (releaseTarget === 'commit') {
    const commitHash = await getCommitHash()
    versionNew = `${versionOld}-commit-${commitHash}`
    isCommitRelease = true
  } else if (releaseTarget === 'patch' || releaseTarget === 'minor' || releaseTarget === 'major') {
    versionNew = semver.inc(versionOld, releaseTarget) as string
  } else {
    assert(releaseTarget.startsWith('v'))
    versionNew = releaseTarget.slice(1)
  }
  return { versionNew, versionOld, isCommitRelease }
}
async function updateVersionMacro(versionOld: string, versionNew: string, filesMonorepo: Files) {
  filesMonorepo
    .filter((f) => f.filePathAbsolute.endsWith('/projectInfo.ts') || f.filePathAbsolute.endsWith('/projectInfo.tsx'))
    .forEach(({ filePathAbsolute }) => {
      assert(path.isAbsolute(filePathAbsolute))
      const getCodeSnippet = (version: string) => `const PROJECT_VERSION = '${version}'`
      const codeSnippetOld = getCodeSnippet(versionOld)
      const codeSnippetNew = getCodeSnippet(versionNew)
      const contentOld = fs.readFileSync(filePathAbsolute, 'utf8')
      assert(contentOld.includes(codeSnippetOld))
      /*
      if (!contentOld.includes(codeSnippetOld)) {
        assert(DEV_MODE)
        return
      }
      */
      const contentNew = contentOld.replace(codeSnippetOld, codeSnippetNew)
      assert(contentNew !== contentOld)
      fs.writeFileSync(filePathAbsolute, contentNew)
    })
}
function updatePackageJsonVersion(pkg: { packageDir: string }, versionNew: string) {
  modifyPackageJson(`${pkg.packageDir}/package.json`, (pkg) => {
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

async function findBoilerplatePacakge(pkg: { packageName: string }, filesMonorepo: Files) {
  const packageJsonFiles = filesMonorepo.filter((f) => f.filePathAbsolute.endsWith('package.json'))
  for (const { filePathAbsolute } of packageJsonFiles) {
    const packageJson = require(filePathAbsolute) as Record<string, unknown>
    const { name } = packageJson
    if (!name) continue
    assert(typeof name === 'string')
    if (name === `create-${pkg.packageName}`) {
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
    return {
      filePathRelative,
      filePathAbsolute: path.join(dir, filePathRelative),
    }
  })
  return files
}

async function undoChanges() {
  await run('git reset --hard HEAD')
}

async function updateDependencies(
  pkg: { packageName: string },
  versionNew: string,
  versionOld: string,
  filesMonorepo: Files,
) {
  filesMonorepo
    .filter((f) => f.filePathAbsolute.endsWith('package.json'))
    .forEach(({ filePathAbsolute }) => {
      modifyPackageJson(filePathAbsolute, (packageJson) => {
        let hasChanged = false
        ;(['dependencies', 'devDependencies'] as const).forEach((deps) => {
          const version = packageJson[deps]?.[pkg.packageName]
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
              console.log(`Wrong ${pkg.packageName} version in ${filePathAbsolute}`)
              throw err
            }
            packageJson[deps][pkg.packageName] = versionNew_range
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

type PackageJson = {
  version: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
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
    if (!swallowError) err
  }
}
async function run__return(cmd: string | string[], dir?: string): Promise<string> {
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  const { stdout } = await execa(command!, args, { cwd: dir })
  return stdout
}

async function abortIfUncommitedChanges(monorepoRootDir: string) {
  const stdout = await run__return(`git status --porcelain`)
  const isDirty = stdout !== ''
  if (isDirty) {
    throw new Error(
      pc.red(
        pc.bold(
          `Release aborted, because the Git repository (${monorepoRootDir}) has uncommitted changes. Commit all changes before releasing a new version.`,
        ),
      ),
    )
  } else {
    cleanEnabled = true
  }
}

async function abortIfNotLatestMainCommit() {
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
  {
    await runCommand('git fetch')
    const stdout = await run__return(`git status`)
    const isNotOriginMain =
      stdout.trim() !==
      `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean`
    if (isNotOriginMain) {
      throw new Error(
        pc.red(
          pc.bold(
            [
              `Release aborted, because the current commit (i.e. ${pc.cyan('HEAD')})`,
              `should be up-to-date with ${pc.cyan('origin/main')}.`,
              `Make sure to push/pull all changes, or use ${pc.cyan('--force')} to skip this check.`,
            ].join(' '),
          ),
        ),
      )
    }
  }
}

async function getCommitHash() {
  const commitHash = (await run__return('git rev-parse HEAD'))
    .trim()
    // Align with GitHub: GitHub (always?) only shows the first 7 characters
    .slice(0, 7)
  return commitHash
}

async function getBranchName() {
  // https://stackoverflow.com/questions/1417957/show-just-the-current-branch-in-git/1418022#1418022
  const branchName = (await run__return('git rev-parse --abbrev-ref HEAD')).trim()
  return branchName
}

function isSamePath(p1: string, p2: string) {
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
  logTitle('Analysis result')
  console.log(`Package root directory: ${pc.bold(packageRootDir)} ${styleDetail('process.cwd()')}`)
  console.log(`Monorepo: ${pc.bold(monorepoInfo.isMonorepo ? 'yes' : 'no')}`)
  if (monorepoInfo.isMonorepo) {
    console.log(`Monorepo root directory: ${pc.bold(monorepoRootDir)} ${styleDetail(`$ ${gitCmdMonorepoRootDir}`)}`)
    console.log('Monorepo packages:')
    monorepoInfo.monorepoPackages.forEach((monorepoPkg) => {
      let line = `- ${pc.bold(monorepoPkg.packageName)} (${monorepoPkg.packageRootDirRelative})`
      if (monorepoPkg.isCurrentPackage) line = pc.cyan(line)
      console.log(line)
    })
  }
}

function logTitle(title: string) {
  const titleLine = `==== ${title} ====`
  const borderLine = '='.repeat(titleLine.length)
  console.log()
  console.log()
  console.log(borderLine)
  console.log(titleLine)
  console.log(borderLine)
}

let cleanRootDir = process.cwd()
let cleanEnabled = false
async function clean(err: unknown) {
  if (err) {
    logTitle('Error')
    console.error(err)
  }
  if (!err && cleanEnabled) {
    await run(`git add ${cleanRootDir}`)
    await run(['git', 'commit', '-am', 'aborted release'])
    await run(`git reset --hard HEAD~`)
  }
  process.exit(1)
}

type MonorepoInfo = ReturnType<typeof analyzeMonorepo>
function analyzeMonorepo(monorepoRootDir: string, filesMonorepo: Files, packageRootDir: string, pkg: Pkg) {
  if (!filesMonorepo.find((f) => f.filePathRelative === 'pnpm-workspace.yaml')) {
    /*
    if( monorepoRootDir !== packageRootDir) throw new Error(`The current working directory ${styleDetail('process.cwd()')} is expected to be ${monorepoRootDir} because, the Git repository doesn't seem to be a monorepo.`)
    */
    return { isMonorepo: false } as const
  }

  let currentPackageFound = false
  const monorepoPackages: {
    packageName: string
    packageRootDirRelative: string
    isCurrentPackage: boolean
  }[] = []
  const pnpmWorkspaceYaml = readYaml('pnpm-workspace.yaml', monorepoRootDir)
  if (pnpmWorkspaceYaml.packages) {
    assert(Array.isArray(pnpmWorkspaceYaml.packages))
    pnpmWorkspaceYaml.packages.forEach((entry) => {
      assert(typeof entry === 'string')
      const monorepoPkg = readPkg(path.join(monorepoRootDir, entry))
      if (!monorepoPkg?.packageName || !monorepoPkg.devDependencies[thisPackageName]) return
      const isCurrentPackage = isSamePath(packageRootDir, entry)
      if (isCurrentPackage) {
        assert(!currentPackageFound)
        currentPackageFound = true
        assert(monorepoPkg.packageName === pkg.packageName)
      }
      monorepoPackages.push({
        packageName: monorepoPkg.packageName,
        packageRootDirRelative: entry,
        isCurrentPackage,
      })
    })
  }
  if (monorepoPackages.length === 0) {
    return { isMonorepo: false } as const
  }
  assert(currentPackageFound)
  return {
    isMonorepo: true as const,
    monorepoPackages,
  }
}

function styleDetail(msg: string) {
  return `(${pc.dim(msg)})`
}
