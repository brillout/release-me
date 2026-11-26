#!/usr/bin/env node

import { program } from 'commander'
import { releaseMe, type ReleaseTarget, type ReleaseType, releaseTypes } from './releaseMe.ts'
import { init } from './ci/init.ts'
import { ciPublish } from './ci/ci-publish.ts'

program
  .name('release-me')
  .usage('[options] <release-target>')
  .showHelpAfterError()
  .argument('<release-target>')
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
  .action(async (releaseTarget: string, options: { force?: true; yes?: true }, command: typeof program) => {
    if (command.args.length !== 1) {
      program.outputHelp()
      process.exit(0)
    }
    if (!isValidReleaseTarget(releaseTarget)) {
      console.error('Wrong CLI usage: argument is invalid.')
      program.outputHelp()
      process.exit(0)
    }
    await releaseMe({ releaseTarget, force: !!options.force, yes: !!options.yes }, process.cwd())
  })

program
  .command('init')
  .description(
    'Create or update .github/workflows/release.yml, the GitHub Action that publishes to npm (see https://github.com/brillout/release-me#github-action).',
  )
  .action(init)

// Run by the GitHub Action (see ./ci/releaseWorkflow.ts)
program.command('ci-publish', { hidden: true }).action(ciPublish)

await program.parseAsync()

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
