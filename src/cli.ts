#!/usr/bin/env node

// In release-me's own repository, `$ release-me` runs this file directly (Node.js strips its types). The npm package runs its build dist/cli.js instead (package.json#publishConfig.bin).

import { Command, program } from 'commander'
import type { CliArgs, ReleaseType, ReleaseTarget } from './releaseMe.ts'

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

// Each command only loads its own code: the GitHub Action's job `publish` runs as little code as possible
switch (process.argv[2]) {
  case 'init':
    await cliInit()
    break
  case 'ci-internal-cmd-pack':
    await (await import('./ci/ci-internal-cmd-pack.ts')).ciPack()
    break
  case 'ci-internal-cmd-publish':
    ;(await import('./ci/ci-internal-cmd-publish.ts')).ciPublish()
    break
  default:
    await cli()
}

async function cliInit() {
  new Command('release-me init')
    .description(
      'Create or update .github/workflows/release.yml, the GitHub Action that publishes to npm (see https://github.com/brillout/release-me#github-action).',
    )
    .showHelpAfterError()
    .parse(process.argv.slice(3), { from: 'user' })
  const { init } = await import('./ci/init.ts')
  await init()
}

async function cli() {
  const { releaseMe, releaseTypes } = await import('./releaseMe.ts')
  const packageRootDir = process.cwd()
  const args = parseArgs(releaseTypes)
  await releaseMe(args, packageRootDir)
}

function parseArgs(releaseTypes: readonly ReleaseType[]): CliArgs {
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
  if (!isValidReleaseTarget(releaseTarget, releaseTypes)) {
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

function isValidReleaseTarget(
  releaseTarget: string,
  releaseTypes: readonly ReleaseType[],
): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
