#!/usr/bin/env node

import { Argument, InvalidArgumentError, program } from 'commander'
import pc from '@brillout/picocolors'
import { releaseMe, type ReleaseTarget, type ReleaseType, releaseTypes } from './releaseMe.ts'
import { init } from './ci/init.ts'
import { ciPublish } from './ci/ci-publish.ts'
import { syncGitHubReleases } from './ci/release-github/cmd/sync-github-releases.ts'
import { deleteAllGitHubReleases } from './ci/release-github/cmd/delete-all-github-releases.ts'

program
  .name('release-me')
  .usage('[options] <release-target>')
  .showHelpAfterError()
  .allowExcessArguments(false)
  .addArgument(new Argument('<release-target>').argParser(parseReleaseTarget))
  .option(
    '--force',
    "skip validation — release even in unexpected situations (e.g. if the release contains no CHANGELOG.md entry, or if HEAD isn't up-to-date with origin/main)",
  )
  .option('--yes', 'skip confirmation — release without prompting the user to confirm the release')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  $ pnpm exec release-me patch                        # bump patch semver',
      '  $ pnpm exec release-me minor                        # bump minor semver',
      '  $ pnpm exec release-me major                        # bump major semver',
      '  $ pnpm exec release-me commit                       # out-of-band release (as x.y.z-commit-123456 without npm tag)',
      '  $ pnpm exec release-me v${major}.${minor}.${patch}  # release specific version',
    ].join('\n'),
  )
  .action(async (releaseTarget: ReleaseTarget, options: { force?: true; yes?: true }) => {
    await releaseMe({ releaseTarget, force: !!options.force, yes: !!options.yes }, process.cwd())
  })

program
  .command('init')
  .description(
    `Create or update the GitHub Actions of release-me (default: the ones already set up, or else both), see ${pc.underline(
      'https://github.com/brillout/release-me#github-action',
    )}.`,
  )
  .option('--npm', 'the GitHub Action .github/workflows/release.yml that publishes to npm')
  .option(
    '--github',
    'the GitHub Action .github/workflows/release-github.yml that syncs GitHub Releases with CHANGELOG.md',
  )
  .action(async (options: { npm?: true; github?: true }) => {
    await init(options)
  })

// Run by the GitHub Action (see ./ci/releaseWorkflowFile.ts)
program.command('ci-publish', { hidden: true }).action(ciPublish)

// Run by the GitHub Action (see ./ci/releaseWorkflowFile.ts), and locally to preview or backfill
program
  .command('github-release-sync-all')
  .description(
    `Create, update, and delete GitHub Releases so that they match CHANGELOG.md (see ${pc.underline(
      'https://github.com/brillout/release-me#github-release',
    )}).`,
  )
  .argument('[packages...]', 'the packages to sync, by name or directory (default: all packages)')
  .option('--dry-run', 'only log the changes, without making them')
  .action(async (packageArgs: string[], options: { dryRun?: true }) => {
    await syncGitHubReleases({ packageArgs, dryRun: !!options.dryRun })
  })

program
  .command('github-release-delete-all')
  .description(
    `⚠️  Delete all GitHub Releases of the repository (CHANGELOG.md and Git tags are kept: ${pc.bold(
      '$ pnpm exec release-me github-release-sync-all',
    )} re-creates them).`,
  )
  .option('--dry-run', 'only log the deletions, without making them')
  .option('--yes', 'skip confirmation')
  .action(async (options: { dryRun?: true; yes?: true }) => {
    await deleteAllGitHubReleases({ dryRun: !!options.dryRun, yes: !!options.yes })
  })

await program.parseAsync()

function parseReleaseTarget(releaseTarget: string): ReleaseTarget {
  if (releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)) {
    return releaseTarget as ReleaseTarget
  }
  throw new InvalidArgumentError(`Expected ${releaseTypes.join(', ')}, or a version (e.g. v1.2.3).`)
}
