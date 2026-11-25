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
type ToPublish = Package & {
  /** `$ npm publish --tag` (`null` => npm's default, i.e. package.json#publishConfig.tag) */
  tag: string | null
  /** Remove the dist-tag after publishing */
  removeTag?: true
  provenance: boolean
}

function ciPublish() {
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (!isReleaseWorkflowUpToDate(getEnv('GITHUB_WORKSPACE'))) fail(releaseWorkflowOutdated)
  const packages = readPackages(getEnv('PACKED_PACKAGES_DIR'))
  const tag = getEnv('TAG')
  const toPublish = tag ? getStableRelease(packages, tag) : getCommitRelease(packages)

  const summary: string[] = []
  for (const p of toPublish) {
    const spec = `${p.name}@${p.version}`
    if (isPublished(p)) {
      console.log(`${spec} is already published, skipping it.`)
    } else {
      npm(
        ['publish', p.tarball, ...(p.tag ? ['--tag', p.tag] : [])],
        p.provenance ? {} : { NPM_CONFIG_PROVENANCE: 'false' },
      )
      if (p.removeTag) {
        try {
          npm(['dist-tag', 'rm', p.name, p.tag!])
        } catch {
          console.log(
            `::warning::Couldn't remove the npm dist-tag ${p.tag} of ${p.name}: on npmjs.com, enable "Allow npm dist-tag" for the trusted publisher ${releaseWorkflowFileName} of ${p.name}.`,
          )
        }
      }
    }
    summary.push(tag ? `- \`${spec}\`` : `- \`${spec}\` — \`npm install ${spec}\``)
  }
  const { GITHUB_STEP_SUMMARY } = process.env
  if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, `### Published to npm\n\n${summary.join('\n')}\n`)
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

function getStableRelease(packages: Package[], tag: string): ToPublish[] {
  const releaseTag = parseReleaseTag(tag)
  if (!releaseTag) fail(`${tag} isn't a release tag.`)
  const { version, packageName } = releaseTag
  const [p, ...others] = packages
  if (!p || others.length > 0 || p.version !== version || p.name !== (packageName ?? p.name)) {
    const expected = `${packageName ?? '<package>'}@${version}`
    fail(`The packages ${list(packages)} don't match the Git tag ${tag}: expected ${expected}.`)
  }
  // npm requires an explicit tag for pre-release versions and for versions lower than the highest published version: use `latest`, as `$ pnpm publish` does (unless package.json#publishConfig.tag is set).
  // Provenance: the workflow runs on the tag's commit (the pushed tag, or the tag selected in "Use workflow from")
  return [{ ...p, tag: p.hasPublishConfigTag ? null : 'latest', provenance: true }]
}

function getCommitRelease(packages: Package[]): ToPublish[] {
  return packages.map((p) => {
    if (!isCommitReleaseVersion(p.version)) {
      fail(`${p.name}@${p.version} isn't a commit release version (x.y.z-commit-<hash>).`)
    }
    // - `$ npm publish` always sets a dist-tag: use the dist-tag `commit` and remove it afterwards.
    // - No provenance: it would point to the commit the workflow run belongs to (the tip of the branch selected in "Use workflow from"), which isn't necessarily the released commit.
    return { ...p, tag: 'commit', removeTag: true, provenance: false }
  })
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
  return packages.map((p) => `${p.name}@${p.version}`).join(', ')
}
