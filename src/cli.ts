#!/usr/bin/env node

import { Argument, InvalidArgumentError, program } from 'commander'
import pc from '@brillout/picocolors'
import { releaseMe, type ReleaseTarget, type ReleaseType, releaseTypes } from './releaseMe.ts'
import { init } from './ci/init.ts'
import { ciPublish } from './ci/ci-publish.ts'

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
    `Create or update .github/workflows/release.yml, the GitHub Action that publishes to npm (see ${pc.underline(
      'https://github.com/brillout/release-me#github-action',
    )}).`,
  )
  .action(init)

// Run by the GitHub Action (see ./ci/releaseWorkflow.ts)
program.command('ci-publish', { hidden: true }).action(ciPublish)

await program.parseAsync()

function parseReleaseTarget(releaseTarget: string): ReleaseTarget {
  if (releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)) {
    return releaseTarget as ReleaseTarget
  }
  throw new InvalidArgumentError(`Expected ${releaseTypes.join(', ')}, or a version (e.g. v1.2.3).`)
}
