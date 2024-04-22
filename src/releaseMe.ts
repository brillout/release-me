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
// import yaml from 'js-yaml'
import readline from 'readline'
import pc from 'picocolors'
import conventionalChangelog from 'conventional-changelog'

const releaseTypes = ['minor', 'patch', 'major', 'commit'] as const
type ReleaseType = (typeof releaseTypes)[number]
type ReleaseTarget = ReleaseType | `v${string}`

type Args = {
  dev: boolean
  force: boolean
  gitTagPrefix: string | null
  releaseTarget: ReleaseTarget
}

async function releaseMe(args: Args, packageRootDir: string) {
  await abortIfUncommitedChanges()

  const filesPackage = await getFilesInsideDir(packageRootDir, true)
  const pkg = await findPackage(packageRootDir, filesPackage)

  const { versionOld, versionNew, isCommitRelease } = await getVersion(pkg, args.releaseTarget)

  if (!isCommitRelease && !args.force) {
    await abortIfNotLatestMainCommit()
  }

  const monorepoRootDir = await getMonorepoRootDir()
  const filesMonorepo = await getFilesInsideDir(monorepoRootDir)

  logAnalysis(monorepoRootDir, packageRootDir)

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

  await updateDependencies(pkg, versionNew, versionOld, filesMonorepo, args.dev)
  const boilerplatePackageJson = await findBoilerplatePacakge(pkg, filesMonorepo)
  if (boilerplatePackageJson) {
    bumpBoilerplateVersion(boilerplatePackageJson)
  }

  const gitTagPrefix = args.gitTagPrefix ? `${args.gitTagPrefix}@` : 'v'

  await changelog(monorepoRootDir, packageRootDir, gitTagPrefix)

  await showPreview(pkg, packageRootDir)
  await askConfirmation()

  if (!args.dev) {
    await bumpPnpmLockFile(monorepoRootDir)
  }

  await gitCommit(versionNew, monorepoRootDir, gitTagPrefix)

  await build()

  await npmPublish(packageRootDir)
  if (boilerplatePackageJson) {
    await publishBoilerplates(boilerplatePackageJson)
  }

  await gitPush()
}

async function findPackage(packageRootDir: string, filesPackage: string[]) {
  // package.json#name
  if (filesPackage.includes('package.json')) {
    const pkg = readPkg(packageRootDir)
    if (pkg) {
      return pkg
    }
  }

  /* Following is commented out because we want to ensure user always runs `pnpm exec release-me` at the package's root directory.
  // ${packagePath}/package.json#name
  if (files.includes('pnpm-workspace.yaml')) {
    const pnpmWorkspaceYaml = readYaml('pnpm-workspace.yaml', { cwd })
    const { packages } = pnpmWorkspaceYaml
    if (packages) {
      assert(Array.isArray(packages))
      const [packagePath] = packages
      assert(typeof packagePath === 'string')
      console.log(cwd)
      const pkg = readPkg(path.join(cwd, packagePath))
      if (pkg) {
        return pkg
      }
    }
  }
  */

  throw new Error(pc.red(pc.bold("Couldn't find package")))
}

function readPkg(dir: string) {
  const { packageJson, packageJsonFile } = readJson('package.json', dir)
  const { name } = packageJson
  if (!name) {
    return null
  }
  const packageDir = path.dirname(packageJsonFile)
  assert(typeof name === 'string')
  return { packageName: name, packageDir }
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
/*
function readYaml(filePathRelative: string, dir: string): Record<string, unknown> {
  const { fileContent } = readFile(filePathRelative, dir)
  const fileParsed: Record<string, unknown> = yaml.load(fileContent) as any
  return fileParsed
}
*/

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

function getChangeLogPath(packageRootDir: string) {
  return path.join(packageRootDir, 'CHANGELOG.md')
}

async function showPreview(pkg: { packageDir: string }, packageRootDir: string) {
  logTitle('Confirm changes')
  await showCmd('git status')
  await diffAndLog(getChangeLogPath(packageRootDir))
  await diffAndLog(path.join(pkg.packageDir, 'package.json'))
  async function diffAndLog(filePath: string) {
    await showCmd(`git diff ${filePath}`, `git --no-pager diff ${filePath}`)
  }
  async function showCmd(cmd: string, cmdReal?: string) {
    cmdReal ??= cmd
    console.log(pc.bold(pc.blue(`$ ${cmd}`)))
    await run(cmdReal)
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
  rl.question(pc.blue(pc.bold('Press <ENTER> to confirm release.')), () => {
    resolve()
    rl.close()
  })
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
async function updateVersionMacro(versionOld: string, versionNew: string, filesMonorepo: string[]) {
  filesMonorepo
    .filter((f) => f.endsWith('/projectInfo.ts') || f.endsWith('/projectInfo.tsx'))
    .forEach((filePath) => {
      assert(path.isAbsolute(filePath))
      const getCodeSnippet = (version: string) => `const PROJECT_VERSION = '${version}'`
      const codeSnippetOld = getCodeSnippet(versionOld)
      const codeSnippetNew = getCodeSnippet(versionNew)
      const contentOld = fs.readFileSync(filePath, 'utf8')
      assert(contentOld.includes(codeSnippetOld))
      /*
      if (!contentOld.includes(codeSnippetOld)) {
        assert(DEV_MODE)
        return
      }
      */
      const contentNew = contentOld.replace(codeSnippetOld, codeSnippetNew)
      assert(contentNew !== contentOld)
      fs.writeFileSync(filePath, contentNew)
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

async function findBoilerplatePacakge(pkg: { packageName: string }, filesMonorepo: string[]) {
  const packageJsonFiles = filesMonorepo.filter((f) => f.endsWith('package.json'))
  for (const packageJsonFile of packageJsonFiles) {
    const packageJson = require(packageJsonFile) as Record<string, unknown>
    const { name } = packageJson
    if (!name) continue
    assert(typeof name === 'string')
    if (name === `create-${pkg.packageName}`) {
      return packageJsonFile
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

async function getFilesInsideDir(dir: string, relative?: true): Promise<string[]> {
  const stdout = await run__return('git ls-files', dir)
  let files = stdout.split(/\s/)
  if (!relative) files = files.map((filePathRelative) => path.join(dir, filePathRelative))
  return files
}

async function undoChanges() {
  await run('git reset --hard HEAD')
}

async function updateDependencies(
  pkg: { packageName: string },
  versionNew: string,
  versionOld: string,
  filesMonorepo: string[],
  devMode: boolean,
) {
  filesMonorepo
    .filter((f) => f.endsWith('package.json'))
    .forEach((packageJsonFile) => {
      modifyPackageJson(packageJsonFile, (packageJson) => {
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
            if (!devMode) {
              try {
                assert.strictEqual(version, versionOld_range)
              } catch (err) {
                console.log(`Wrong ${pkg.packageName} version in ${packageJsonFile}`)
                throw err
              }
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

async function run(cmd: string | string[], { dir, env = process.env }: { dir?: string; env?: NodeJS.ProcessEnv } = {}) {
  const stdio = 'inherit'
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  await execa(command!, args, { cwd: dir, stdio, env })
}
async function run__return(cmd: string | string[], dir?: string): Promise<string> {
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  const { stdout } = await execa(command!, args, { cwd: dir })
  return stdout
}

async function abortIfUncommitedChanges() {
  const stdout = await run__return(`git status --porcelain`)
  const isDirty = stdout !== ''
  if (isDirty) {
    throw new Error(
      pc.red(
        pc.bold(
          `Cannot release: your Git repository has uncommitted changes. Make sure to commit all changes before releasing a new version.`,
        ),
      ),
    )
  }
}

async function abortIfNotLatestMainCommit() {
  const errPrefix = 'Cannot release:'
  {
    const stdout = await run__return(`git rev-parse --abbrev-ref HEAD`)
    const branch = stdout.trim()
    if ('main' !== branch) {
      throw new Error(
        pc.red(
          pc.bold(
            `${errPrefix} the current branch is ${pc.cyan(branch)} but it should be ${pc.cyan(
              'main',
            )} (or use ${pc.cyan('--force')})`,
          ),
        ),
      )
    }
  }
  {
    await runCommand('git fetch')
    const stdout = await run__return(`git status`)
    const isDirty =
      stdout.trim() !==
      `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean`
    if (isDirty) {
      throw new Error(
        pc.red(
          pc.bold(
            `Release aborted, because ${errPrefix} ${pc.cyan('HEAD')} should be 1. ${pc.cyan(
              'main',
            )} and 2. up to date with ${pc.cyan('origin/main')}, or use ${pc.cyan('--force')}.`,
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
  return monorepoRootDir
}

function logAnalysis(monorepoRootDir: string, packageRootDir: string) {
  logTitle('Analysis result')
  const why = (src: string) => `(${pc.dim(src)})`
  console.log(`Monorepo root directory: ${pc.bold(monorepoRootDir)} ${why(`$ ${gitCmdMonorepoRootDir}`)}`)
  console.log(`Package root directory: ${pc.bold(packageRootDir)} ${why('process.cwd()')}`)
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
