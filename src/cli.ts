#!/usr/bin/env node

import { Argument, InvalidArgumentError, program } from 'commander'
import pc from '@brillout/picocolors'
import { releaseMe, type ReleaseTarget, type ReleaseType, releaseTypes } from './releaseMe.ts'
import { init } from './github-actions/init.ts'
import { npmConnection } from './github-actions/npmConnection.ts'
import { ciPublish } from './github-actions/release-npm/cli/ci-publish.ts'
import { githubReleaseSync } from './github-actions/release-github/cli/github-release-sync.ts'
import { githubReleaseDeleteAll } from './github-actions/release-github/cli/github-release-delete-all.ts'

program
  .name('release-me')
  .usage('[options] <release-target>')
  .showHelpAfterError()
  .allowExcessArguments(false)
  // The options after a command are the command's (e.g. `$ release-me github-release-delete-all --yes`), not the program's
  .enablePositionalOptions()
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
    `Create or update the GitHub Actions of release-me (default: the ones already set up, or else both), and set up the rest (it lists the steps first), see ${pc.underline(
      'https://github.com/brillout/release-me#get-started',
    )}.`,
  )
  .option('--npm', 'the GitHub Action .github/workflows/release-npm.yml that publishes to npm')
  .option(
    '--github',
    'the GitHub Action .github/workflows/release-github.yml that syncs GitHub Releases with CHANGELOG.md',
  )
  .action(init)

program
  .command('npm-connection')
  .description(
    "Show the npm <=> GitHub connection of each package (npm's trusted publisher), and fix it (npm asks for 2FA).",
  )
  .action(npmConnection)

// Run by the GitHub Action (see ./github-actions/workflowFiles.ts)
program.command('ci-publish', { hidden: true }).action(ciPublish)

// Run by the GitHub Action (see ./github-actions/workflowFiles.ts), and locally to preview or backfill
program
  .command('github-release-sync')
  .description(
    `Create, update, and delete GitHub Releases so that they match CHANGELOG.md (see ${pc.underline(
      'https://github.com/brillout/release-me#github-release',
    )}).`,
  )
  .argument('[packages...]', 'the packages to sync, by name or directory (default: all packages)')
  .option('--dry-run', 'only log the changes, without making them')
  .action(async (packageArgs: string[], options: { dryRun?: true }) => {
    await githubReleaseSync({ packageArgs, dryRun: !!options.dryRun })
  })

program
  .command('github-release-delete-all')
  .description(
    `⚠️  Delete all GitHub Releases of the repository (CHANGELOG.md and Git tags are kept: ${pc.bold(
      '$ pnpm exec release-me github-release-sync',
    )} re-creates them).`,
  )
  .option('--dry-run', 'only log the deletions, without making them')
  .option('--yes', 'skip confirmation')
  .action(async (options: { dryRun?: true; yes?: true }) => {
    await githubReleaseDeleteAll({ dryRun: !!options.dryRun, yes: !!options.yes })
  })

await program.parseAsync()

function parseReleaseTarget(releaseTarget: string): ReleaseTarget {
  if (releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)) {
    return releaseTarget as ReleaseTarget
  }
  throw new InvalidArgumentError(`Expected ${releaseTypes.join(', ')}, or a version (e.g. v1.2.3).`)
}
