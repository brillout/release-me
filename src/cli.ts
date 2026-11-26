#!/usr/bin/env node

import { Command, program } from 'commander'
import { type CliArgs, releaseMe, type ReleaseType, releaseTypes, type ReleaseTarget } from './releaseMe.ts'
import { init } from './ci/init.ts'
import { ciPublish } from './ci/ci-publish.ts'

const helpText = [
  '',
  'Examples:',
  '  $ pnpm exec release-me patch                        # bump patch semver',
  '  $ pnpm exec release-me minor                        # bump minor semver',
  '  $ pnpm exec release-me major                        # bump major semver',
  '  $ pnpm exec release-me commit                       # out-of-band release (as x.y.z-commit-123456 without npm tag)',
  '  $ pnpm exec release-me v${major}.${minor}.${patch}  # release specific version',
  '',
  'To set up GitHub Action (see https://github.com/brillout/release-me#github-action):',
  '  $ pnpm exec release-me init                         # create/update .github/workflows/release.yml (GitHub Action that publishes to npm)',
].join('\n')

switch (process.argv[2]) {
  case 'init':
    await cliInit()
    break
  case 'ci-publish':
    await ciPublish()
    break
  default:
    await cliReleaseMe()
}

async function cliInit() {
  new Command('release-me init')
    .description(
      'Create or update .github/workflows/release.yml, the GitHub Action that publishes to npm (see https://github.com/brillout/release-me#github-action).',
    )
    .showHelpAfterError()
    .parse(process.argv.slice(3), { from: 'user' })
  await init()
}

async function cliReleaseMe() {
  const packageRootDir = process.cwd()
  const args = parseArgs()
  await releaseMe(args, packageRootDir)
}

function parseArgs(): CliArgs {
  program
    .name('release-me')
    .option(
      '--force',
      "skip validation — release even in unexpected situations (e.g. if the release contains no CHANGELOG.md entry, or if HEAD isn't up-to-date with origin/main)",
    )
    .option('--yes', 'skip confirmation — release without prompting the user to confirm the release')
    .argument('<release-target>')
  program.addHelpText('afterAll', helpText)
  program.showHelpAfterError()
  program.parse()
  // At this point, program.args contains the positional arguments and program.opts() contains the flags.

  if (program.args.length !== 1) {
    program.outputHelp()
    process.exit(0)
  }

  const releaseTarget = program.args[0]
  if (!releaseTarget) {
    console.error('Wrong CLI usage: argument is missing.')
    program.outputHelp()
    process.exit(0)
  }
  if (!isValidReleaseTarget(releaseTarget)) {
    console.error('Wrong CLI usage: argument is invalid.')
    program.outputHelp()
    process.exit(0)
  }

  return {
    force: (program.opts().force as boolean) || false,
    yes: (program.opts().yes as boolean) || false,
    releaseTarget,
  }
}

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
