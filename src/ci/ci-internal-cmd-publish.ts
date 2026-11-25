export { ciPublish }

// `$ release-me ci-internal-cmd-publish`: job `publish` of the GitHub Action, publishes the tarballs made by the job `pack`.
// The job `pack` runs the repository's code: the package.json inside each tarball (that's what npm publishes) is verified.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { isCommitReleaseVersion, parseReleaseTag } from './versions.ts'
import { fail, getEnv } from './utils.ts'
import { isReleaseWorkflowUpToDate, releaseWorkflowFileName, releaseWorkflowOutdated } from './releaseWorkflow.ts'

type Package = { tarball: string; name: string; version: string; hasPublishConfigTag: boolean }

function ciPublish() {
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (!isReleaseWorkflowUpToDate(getEnv('GITHUB_WORKSPACE'))) fail(releaseWorkflowOutdated)
  const packages = readPackages(getEnv('PACKED_PACKAGES_DIR'))
  const tag = getEnv('TAG')
  if (tag) assertStableRelease(packages, tag)
  else assertCommitRelease(packages)

  for (const p of packages) {
    if (isPublished(p)) {
      console.log(`${getSpec(p)} is already published, skipping it.`)
    } else if (tag) {
      publishStableRelease(p)
    } else {
      publishCommitRelease(p)
    }
  }
  writeSummary(packages, !tag)
}

function readPackages(packagesDir: string): Package[] {
  const packages = fs
    .readdirSync(packagesDir)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => {
      const tarball = path.resolve(packagesDir, file)
      const packageJson = JSON.parse(
        execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
      )
      return {
        tarball,
        name: packageJson.name,
        version: packageJson.version,
        hasPublishConfigTag: !!packageJson.publishConfig?.tag,
      }
    })
  if (packages.length === 0) fail('No package to publish.')
  return packages
}

function assertStableRelease(packages: Package[], tag: string) {
  const releaseTag = parseReleaseTag(tag)
  if (!releaseTag) fail(`${tag} isn't a release tag.`)
  const { version, packageName } = releaseTag
  const [p, ...others] = packages
  if (!p || others.length > 0 || p.version !== version || (packageName && p.name !== packageName)) {
    const expected = `${packageName ?? '<package>'}@${version}`
    fail(`The packages ${list(packages)} don't match the Git tag ${tag}: expected ${expected}.`)
  }
}

function assertCommitRelease(packages: Package[]) {
  for (const p of packages) {
    if (!isCommitReleaseVersion(p.version)) fail(`${getSpec(p)} isn't a commit release version (x.y.z-commit-<hash>).`)
  }
}

function publishStableRelease(p: Package) {
  // - npm requires an explicit tag for pre-release versions and for versions lower than the highest published version: use `latest`, as `$ pnpm publish` does (unless package.json#publishConfig.tag is set).
  // - Provenance (npm's default with trusted publishing): the workflow runs on the tag's commit (the pushed tag, or the tag selected in "Use workflow from").
  npm(['publish', p.tarball, ...(p.hasPublishConfigTag ? [] : ['--tag', 'latest'])])
}

function publishCommitRelease(p: Package) {
  // - `$ npm publish` always sets a dist-tag: use the dist-tag `commit` and remove it afterwards.
  // - No provenance: it would point to the commit the workflow run belongs to (the tip of the branch selected in "Use workflow from"), which isn't necessarily the released commit.
  npm(['publish', p.tarball, '--tag', 'commit'], { NPM_CONFIG_PROVENANCE: 'false' })
  try {
    npm(['dist-tag', 'rm', p.name, 'commit'])
  } catch {
    console.log(
      `::warning::Couldn't remove the npm dist-tag commit of ${p.name}: on npmjs.com, enable "Allow npm dist-tag" for the trusted publisher ${releaseWorkflowFileName} of ${p.name}.`,
    )
  }
}

/** The summary of the GitHub Action run */
function writeSummary(packages: Package[], isCommitRelease: boolean) {
  const { GITHUB_STEP_SUMMARY } = process.env
  if (!GITHUB_STEP_SUMMARY) return
  const lines = packages.map((p) => {
    const spec = getSpec(p)
    return isCommitRelease ? `- \`${spec}\` — \`npm install ${spec}\`` : `- \`${spec}\``
  })
  fs.appendFileSync(GITHUB_STEP_SUMMARY, `### Published to npm\n\n${lines.join('\n')}\n`)
}

function isPublished({ name, version }: Package): boolean {
  try {
    const stdout = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
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

function list(packages: Package[]): string {
  return packages.map(getSpec).join(', ')
}
function getSpec(p: Package): string {
  return `${p.name}@${p.version}`
}
