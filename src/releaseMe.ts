export { releaseMe }

import execa from 'execa'
import { writeFileSync, readFileSync } from 'fs'
import assert from 'assert'
//import { DIR_BOILERPLATES, DIR_SRC, DIR_ROOT } from './helpers/locations'
const DIR_BOILERPLATES = 'TODO'
const DIR_SRC = 'TODO'
const DIR_ROOT = 'TODO'
import * as semver from 'semver'
import { runCommand } from './utils'
import * as path from 'path'
import yaml from 'js-yaml'

const DEV_MODE = true

async function releaseMe(versionNew: string | null) {
  const pkg = await findPackage()
  console.log(pkg)

  const versions = getVersion(pkg, versionNew)
  const { versionOld } = versions
  versionNew = versions.versionNew
  assert(versionNew)
  console.log(versionOld, versionNew)

  await updateVersionMacro(versionOld, versionNew)

  // Update pacakge.json versions
  updatePackageJsonVersion(pkg, versionNew)

  await updateDependencies(pkg, versionNew, versionOld)
  const boilerplatePackageJson = await findBoilerplatePacakge(pkg)
  if (boilerplatePackageJson) {
    bumpBoilerplateVersion(boilerplatePackageJson)
  }

  /*
  await bumpPnpmLockFile()

  await changelog()

  await build()

  await publish()
  await publishBoilerplates()

  await gitCommit(versionNew)
  await gitPush()
  */

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

    throw new Error("Couldn't find package")
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
  function readYaml(filePathRelative: string, { cwd }: { cwd: string }): Record<string, unknown> {
    const { fileContent } = readFile(filePathRelative, { cwd })
    const fileParsed: Record<string, unknown> = yaml.load(fileContent) as any
    return fileParsed
  }

  async function publish() {
    await npmPublish(DIR_SRC)
  }
  async function publishBoilerplates() {
    if (!DIR_BOILERPLATES) {
      return
    }
    await npmPublish(DIR_BOILERPLATES)
  }
  async function npmPublish(cwd: string) {
    // Fix for: (see https://github.com/yarnpkg/yarn/issues/2935#issuecomment-487020430)
    // > npm ERR! need auth You need to authorize this machine using `npm adduser`
    const env = { ...process.env, npm_config_registry: undefined }
    await run('npm', ['publish'], { cwd, env })
  }

  async function changelog() {
    // Usage examples:
    //  - pnpm exec conventional-changelog --preset angular
    //  - pnpm exec conventional-changelog --preset angular --infile CHANGELOG.md --same-file
    //  - pnpm exec conventional-changelog --preset angular --infile CHANGELOG.md --same-file --pkg ./path/to/pkg
    await run('pnpm', [
      'exec',
      'conventional-changelog',
      '--preset',
      'angular',
      '--infile',
      'CHANGELOG.md',
      '--same-file',
      '--pkg',
      DIR_SRC
    ])
  }
  async function gitCommit(versionNew: string) {
    const tag = `v${versionNew}`
    await run('git', ['commit', '-am', `release: ${tag}`])
    await run('git', ['tag', tag])
  }
  async function gitPush() {
    await run('git', ['push'])
    await run('git', ['push', '--tags'])
  }
  async function build() {
    await run('pnpm', ['run', 'build'])
  }

  function getVersion(
    pkg: { packageDir: string },
    versionNew: string | null
  ): { versionNew: string; versionOld: string } {
    const packageJson = require(`${pkg.packageDir}/package.json`) as PackageJson
    const versionOld = packageJson.version
    assert(versionOld)
    if (!versionNew) {
      versionNew = semver.inc(versionOld, 'patch') as string
    }
    assert(versionNew.startsWith('0.'))
    assert(versionOld.startsWith('0.'))
    return { versionNew, versionOld }
  }
  async function updateVersionMacro(versionOld: string, versionNew: string) {
    const filesAll = await getFilesAll()
    filesAll
      .filter((f) => f.endsWith('/projectInfo.ts'))
      .forEach((filePath) => {
        assert(path.isAbsolute(filePath))
        const getCodeSnippet = (version: string) => `const PROJECT_VERSION = '${version}'`
        const codeSnippetOld = getCodeSnippet(versionOld)
        const codeSnippetNew = getCodeSnippet(versionNew)
        const contentOld = readFileSync(filePath, 'utf8')
        if (!contentOld.includes(codeSnippetOld)) {
          assert(DEV_MODE)
          return
        }
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

  async function findBoilerplatePacakge(pkg: { packageName: string }) {
    const filesAll = await getFilesAll()
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

  async function bumpPnpmLockFile() {
    try {
      await runCommand('pnpm install', { cwd: DIR_ROOT, timeout: 10 * 60 * 1000 })
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

  async function getFilesAll(): Promise<string[]> {
    const projectRootDir = (await run__return('git rev-parse --show-toplevel', { cwd: process.cwd() })).trim()
    let filesAll = await getFilesCwd(projectRootDir)
    filesAll = filesAll.map((filePathRelative) => path.join(projectRootDir, filePathRelative))
    return filesAll
  }

  async function updateDependencies(pkg: { packageName: string }, versionNew: string, versionOld: string) {
    const filesAll = await getFilesAll()
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
            if (!DEV_MODE) {
              assert.strictEqual(version, versionOld_range)
            }
            packageJson[deps][pkg.packageName] = versionNew_range
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

  async function run(cmd: string, args: string[], { cwd = DIR_ROOT, env = process.env } = {}) {
    const stdio = 'inherit'
    await execa(cmd, args, { cwd, stdio, env })
  }
  async function run__return(cmd: string, { cwd = DIR_ROOT } = {}): Promise<string> {
    const [command, ...args] = cmd.split(' ')
    const { stdout } = await execa(command, args, { cwd })
    return stdout
  }
}
