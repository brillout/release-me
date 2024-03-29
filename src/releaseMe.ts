export { releaseMe }
export { releaseTypes }
export type { Args }
export type { ReleaseType }
export type { ReleaseTarget }

import execa from 'execa'
import { writeFileSync, readFileSync } from 'fs'
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
  gitPrefix: string | null
  changelogDir: string
  releaseTarget: ReleaseTarget
}

async function releaseMe(args: Args) {
  await abortIfUncommitedChanges()

  const pkg = await findPackage()

  const { versionOld, versionNew, isCommitRelease } = await getVersion(pkg, args.releaseTarget)

  if (!isCommitRelease && !args.force) {
    await abortIfNotLatestMainCommit()
  }

  const projectRootDir = (await run__return('git rev-parse --show-toplevel', { cwd: process.cwd() })).trim()

  await updateVersionMacro(versionOld, versionNew, projectRootDir)

  if (isCommitRelease) {
    updatePackageJsonVersion(pkg, versionNew)
    await build()
    await publishCommitRelease(pkg)
    await undoChanges()
    return
  }

  // Update pacakge.json versions
  updatePackageJsonVersion(pkg, versionNew)

  await updateDependencies(pkg, versionNew, versionOld, projectRootDir, args.dev)
  const boilerplatePackageJson = await findBoilerplatePacakge(pkg, projectRootDir)
  if (boilerplatePackageJson) {
    bumpBoilerplateVersion(boilerplatePackageJson)
  }

  const gitTagPrefix = args.gitPrefix ? `${args.gitPrefix}@` : 'v'

  await changelog(projectRootDir, args.changelogDir, gitTagPrefix)

  await showPreview(pkg, projectRootDir, args.changelogDir)
  await askConfirmation()

  if (!args.dev) {
    await bumpPnpmLockFile(projectRootDir)
  }

  await gitCommit(versionNew, projectRootDir, gitTagPrefix)

  await build()

  await publish()
  if (boilerplatePackageJson) {
    await publishBoilerplates(boilerplatePackageJson)
  }

  await gitPush()
}

async function findPackage() {
  const cwd = process.cwd()
  const files = await getFilesCwd(cwd)

  // package.json#name
  if (files.includes('package.json')) {
    const pkg = readPkg(cwd)
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

function readPkg(cwd: string) {
  const { packageJson, packageJsonFile } = readJson('package.json', { cwd })
  const { name } = packageJson
  if (!name) {
    return null
  }
  const packageDir = path.dirname(packageJsonFile)
  assert(typeof name === 'string')
  return { packageName: name, packageDir }
}

function readFile(filePathRelative: string, { cwd }: { cwd: string }) {
  const filePathAbsolute = path.join(cwd, filePathRelative)
  const fileContent = readFileSync(filePathAbsolute, 'utf8')
  return { fileContent, filePath: filePathAbsolute }
}

function readJson(filePathRelative: string, { cwd }: { cwd: string }) {
  const { fileContent, filePath } = readFile(filePathRelative, { cwd })
  const fileParsed: Record<string, unknown> = JSON.parse(fileContent)
  return { packageJson: fileParsed, packageJsonFile: filePath }
}
/*
  function readYaml(filePathRelative: string, { cwd }: { cwd: string }): Record<string, unknown> {
    const { fileContent } = readFile(filePathRelative, { cwd })
    const fileParsed: Record<string, unknown> = yaml.load(fileContent) as any
    return fileParsed
  }
  */

async function publish() {
  await npmPublish(process.cwd())
}
async function publishCommitRelease(pkg: { packageName: string }) {
  const cwd = process.cwd()
  await npmPublish(cwd, 'commit')
  await removeNpmTag(cwd, 'commit', pkg.packageName)
}
async function publishBoilerplates(boilerplatePackageJson: string) {
  await npmPublish(path.dirname(boilerplatePackageJson))
}
async function npmPublish(cwd: string, tag?: string) {
  const env = getNpmFix()
  let cmd = 'npm publish'
  if (tag) {
    cmd = `${cmd} --tag ${tag}`
  }
  await run(cmd, { cwd, env })
}
async function removeNpmTag(cwd: string, tag: string, packageName: string) {
  const env = getNpmFix()
  await run(`npm dist-tag rm ${packageName} ${tag}`, { cwd, env })
}

// Fix for: (see https://github.com/yarnpkg/yarn/issues/2935#issuecomment-487020430)
// > npm ERR! need auth You need to authorize this machine using `npm adduser`
function getNpmFix() {
  return { ...process.env, npm_config_registry: undefined }
}

async function changelog(projectRootDir: string, changelogDir: string, gitTagPrefix: string) {
  const readable = conventionalChangelog(
    {
      preset: 'angular',
      tagPrefix: gitTagPrefix
    },
    undefined,
    undefined,
    {
      // Modify revertPattern set by node_modules/conventional-changelog-angular/parserOpts.js to skip the default commit message upon `$ git revert`
      revertPattern: /^revert:\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i
    }
  )
  const changelog = await streamToString(readable)
  prerendFile(getChangeLogPath(projectRootDir, changelogDir), changelog)
  /*
    const pkgDir = process.cwd()
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
        pkgDir
      ],
      { cwd: pkgDir }
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
    content = readFileSync(filePath, 'utf8')
  } catch {}
  content = prerendString + content
  writeFileSync(filePath, content)
}

function getChangeLogPath(projectRootDir: string, changelogDir: string) {
  return path.join(projectRootDir, changelogDir, 'CHANGELOG.md')
}

async function showPreview(pkg: { packageDir: string }, projectRootDir: string, changelogDir: string) {
  await showCmd('git status')
  await diffAndLog(getChangeLogPath(projectRootDir, changelogDir))
  await diffAndLog(path.join(pkg.packageDir, 'package.json'))
  async function diffAndLog(filePath: string) {
    await showCmd(`git diff ${filePath}`, `git --no-pager diff ${filePath}`)
  }
  async function showCmd(cmd: string, cmdReal?: string) {
    cmdReal ??= cmd
    console.log()
    console.log(pc.bold(pc.blue(`$ ${cmd}`)))
    await run(cmdReal)
  }
}

function askConfirmation(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  let resolve: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  console.log()
  rl.question(pc.blue(pc.bold('Press <ENTER> to confirm release.')), () => {
    resolve()
    rl.close()
  })
  return promise
}

async function gitCommit(versionNew: string, projectRootDir: string, gitTagPrefix: string) {
  const tag = `${gitTagPrefix}${versionNew}`
  await run('git add .', { cwd: projectRootDir })
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
  releaseTarget: ReleaseTarget
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
async function updateVersionMacro(versionOld: string, versionNew: string, projectRootDir: string) {
  const filesAll = await getFilesAll(projectRootDir)
  filesAll
    .filter((f) => f.endsWith('/projectInfo.ts') || f.endsWith('/projectInfo.tsx'))
    .forEach((filePath) => {
      assert(path.isAbsolute(filePath))
      const getCodeSnippet = (version: string) => `const PROJECT_VERSION = '${version}'`
      const codeSnippetOld = getCodeSnippet(versionOld)
      const codeSnippetNew = getCodeSnippet(versionNew)
      const contentOld = readFileSync(filePath, 'utf8')
      assert(contentOld.includes(codeSnippetOld))
      /*
      if (!contentOld.includes(codeSnippetOld)) {
        assert(DEV_MODE)
        return
      }
      */
      const contentNew = contentOld.replace(codeSnippetOld, codeSnippetNew)
      assert(contentNew !== contentOld)
      writeFileSync(filePath, contentNew)
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

async function findBoilerplatePacakge(pkg: { packageName: string }, projectRootDir: string) {
  const filesAll = await getFilesAll(projectRootDir)
  const packageJsonFiles = filesAll.filter((f) => f.endsWith('package.json'))
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

async function bumpPnpmLockFile(projectRootDir: string) {
  try {
    await runCommand('pnpm install', { cwd: projectRootDir, timeout: 10 * 60 * 1000 })
  } catch (err) {
    if (!(err as Error).message.includes('ERR_PNPM_PEER_DEP_ISSUES')) {
      throw err
    }
  }
}

async function getFilesCwd(cwd: string): Promise<string[]> {
  const stdout = await run__return('git ls-files', { cwd })
  const files = stdout.split(/\s/)
  return files
}

async function undoChanges() {
  await run('git reset --hard HEAD')
}

async function getFilesAll(projectRootDir: string): Promise<string[]> {
  let filesAll = await getFilesCwd(projectRootDir)
  filesAll = filesAll.map((filePathRelative) => path.join(projectRootDir, filePathRelative))
  return filesAll
}

async function updateDependencies(
  pkg: { packageName: string },
  versionNew: string,
  versionOld: string,
  projectRootDir: string,
  devMode: boolean
) {
  const filesAll = await getFilesAll(projectRootDir)
  filesAll
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
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

type PackageJson = {
  version: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

async function run(cmd: string | string[], { cwd = process.cwd(), env = process.env } = {}) {
  const stdio = 'inherit'
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  await execa(command!, args, { cwd, stdio, env })
}
async function run__return(cmd: string | string[], { cwd = process.cwd() } = {}): Promise<string> {
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  const { stdout } = await execa(command!, args, { cwd })
  return stdout
}

async function abortIfUncommitedChanges() {
  const stdout = await run__return(`git status --porcelain`)
  const isDirty = stdout !== ''
  if (isDirty) {
    throw new Error(
      pc.red(
        pc.bold(
          `Cannot release: your Git repository has uncommitted changes. Make sure to commit all changes before releasing a new version.`
        )
      )
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
              'main'
            )} (or use ${pc.cyan('--force')})`
          )
        )
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
          pc.bold(`Release aborted, because ${errPrefix} ${pc.cyan('HEAD')} should be 1. ${pc.cyan('main')} and 2. up to date with ${pc.cyan('origin/main')}, or use ${pc.cyan('--force')}.`)
        )
      )
    }
  }
}

async function getCommitHash() {
  const commitHash = (await run__return('git rev-parse HEAD', { cwd: process.cwd() }))
    .trim()
    // Align with GitHub: GitHub (always?) only shows the first 7 characters
    .slice(0, 7)
  return commitHash
}
