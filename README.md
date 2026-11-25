# `@brillout/release-me`

Publish your npm packages.

Used by:
- Vike
- Telefunc
- Packages made by [`brillout`](https://github.com/brillout)
- Packages made by [`magne4000`](https://github.com/magne4000)

[Features](#features)  
[Get started](#get-started)  
[Usage](#usage)  
[Monorepo](#monorepo)  
[GitHub Action](#github-action)  

> [!WARNING]
> Don't use this: it's only meant for Vike's team & friends. That said, feel free to fork this project.

<br/>

## Features

- Generates `CHANGELOG.md`.
- Monorepo support.
- Generates Git release tags.
- Pre-release support. (For example [`0.4.177-commit-ff3d6cd`](https://www.npmjs.com/package/vike/v/0.4.177-commit-ff3d6cd).)
- Can publish via a GitHub Action instead of your machine: no npm login/2FA/token needed. (See [GitHub Action](#github-action).)
- Asks for confirmation before publishing, and shows a preview of the changes made to `package.json` and `CHANGELOG.md`, enabling you to double check before publishing.

<br/>

## Get started

### Installation

Run `$ pnpm -D @brillout/release-me` and make sure you have the following:

```json5
// package.json
{
  "name": "my-package",
  "version": "0.1.2",
  "scripts": {
    "build": "echo 'Some build step (release-me runs the build script before releasing)'"
  },
  "devDependencies": {
    "@brillout/release-me": "^0.4.0"
  }
}
```

That's it: you can now use `pnpm exec release-me patch` to release a new patch version.

We recommend adding the following scripts:

```diff
 // package.json
 {
   "name": "my-package",
   "version": "0.1.2",
   "scripts": {
     "build": "echo 'Some build step (release-me runs the build script before releasing)'"
+    "release": "release-me patch",
+    "release:minor": "release-me minor",
+    "release:major": "release-me major",
+    "release:commit": "release-me commit"
   },
   "devDependencies": {
     "@brillout/release-me": "^0.4.0"
   }
 }
```

It's a convenient way to communicate how new versions are released to anyone who's discovering your project.

Installation example: [`8ff59fe`](https://github.com/brillout/test-e2e/commit/8ff59fea41c4956aeaf18b048a34faeaf98a47c5).

A `CHANGELOG.md` file will be automatically generated and updated, see the following section.

### Conventional Commits

For proper `CHANGELOG.md` generation make sure to follow [Conventional Commits](https://www.conventionalcommits.org).

In other words:

- `fix:` => bug fix or some polishing (e.g. improved error message).
- `feat:` => new feature, i.e. new functionality.

For breaking changes append `BREAKING CHANGE:` to the commit message:

```
fix: make someFunction() take an argument object

BREAKING CHANGE: Replace `someFunction(someArg)` with `someFunction({ someArg })`.
```

> [!NOTE]
> When introducing a breaking change, in order to respect the [semver](https://semver.org/) convention, don't `pnpm exec release-me patch` but do `pnpm exec release-me major` instead (or `pnpm exec release-me minor` if your package's version is `0.y.z`).

<br/>

## Usage

Release a new patch/minor/major version:

```shell
pnpm exec release-me patch
```
```shell
pnpm exec release-me minor
```
```shell
pnpm exec release-me major
```

> [!NOTE]
> We recommend defining `package.json#scripts` (see above) and use `$ pnpm run` instead of `$ pnpm exec`.

Release specific version:

```shell
pnpm exec release-me v0.1.2
```

You can also publish pre-releases such as [`0.4.177-commit-ff3d6cd`](https://www.npmjs.com/package/vike/v/0.4.177-commit-ff3d6cd):

```shell
pnpm exec release-me commit
```

<br/>

## Monorepo

### `CHANGELOG.md` & commit scope

When releasing a package from a monorepo, the following commits are added to the `CHANGELOG.md` of the package:

- If the commit has a scope (e.g. `fix(some-package): some commit`), it is included only if the scope matches the package's `package.json#name`.
- If the commit has no scope (e.g. `fix: some commit`), it is included only if it modifies a file within the package's root directory (i.e. the directory where the package's `package.json` lives).

> [!NOTE]
> By default, `CHANGELOG.md` lives at the directory of each package directory (`$packageRootDir/CHANGELOG.md`), except if the repository has only one package and `CHANGELOG.md` already exists at `$monorepoRootDir/CHANGELOG.md`.

### Release script

Consider adding `release` scripts to the monorepo root's `package.json`:

```diff
  // package.json
  {
    "scripts": {
+     "release": "pnpm --recursive --sequential run release --yes",
+     "release:minor": "pnpm --recursive --sequential run release:minor --yes",
+     "release:major": "pnpm --recursive --sequential run release:major --yes",
+     "release:commit": "pnpm --recursive --sequential run release:commit --yes",
    }
  }
```

> [!NOTE]
> The `--yes` argument makes the release proceed without prompting for confirmation.

<br/>

## GitHub Action

Instead of publishing from your machine (which requires npm 2FA), a GitHub Action can publish to npm using [npm's trusted publishing](https://docs.npmjs.com/trusted-publishers) — no npm login and no npm token.

`release-me` then works like this:

- `$ pnpm exec release-me patch` (or `minor`/`major`/`v1.2.3`) does the same as before (`CHANGELOG.md`, confirmation, build, Git commit & tag) but, instead of publishing to npm, it pushes the release commit and its Git tag, which triggers the GitHub Action that publishes to npm.
- `$ pnpm exec release-me commit` triggers the GitHub Action that builds and publishes the commit release (it requires the [GitHub CLI `gh`](https://cli.github.com)).
- You can also commit-release any commit from GitHub's UI: go to the workflow page (`https://github.com/${owner}/${repo}/actions/workflows/release.yml`), press **Run workflow**, and enter the commit (a SHA, a branch, or `refs/pull/${number}/head` for a pull request — including pull requests from forks). Leave it empty to release the tip of the selected branch.

### Setup

1. Add `.github/workflows/release.yml` (`release-me` detects it and stops publishing from your machine):
   ```yaml
   name: Release
   on:
     push:
       tags:
         - 'v[0-9]*' # v1.2.3
         - '**@[0-9]*' # some-package@1.2.3, @some-scope/some-package@1.2.3
     workflow_dispatch:
       inputs:
         commit:
           description: 'Commit to release as x.y.z-commit-<hash>: SHA, branch, or refs/pull/<number>/head (empty: the selected branch)'
           required: false
         package:
           description: 'Package to release (empty: all packages using @brillout/release-me)'
           required: false
   jobs:
     release:
       uses: brillout/release-me/.github/workflows/publish.yml@main
       permissions:
         contents: read
         id-token: write
       with:
         commit: ${{ inputs.commit }}
         package: ${{ inputs.package }}
         # node-version: 24 # Default: lts/*
         # pnpm-version: 10 # Default: package.json#packageManager
   ```
1. On [npmjs.com](https://www.npmjs.com), for each package (including the boilerplate `create-${packageName}` if you have one), go to **Settings** > **Trusted publishing** > **GitHub Actions** and set:
   - **Organization or user** and **Repository**: your GitHub repository (it must match `package.json#repository`).
   - **Workflow filename**: `release.yml`
   - **Allowed actions**: `npm publish` (otherwise npm only allows staged publishing, which requires approving each release with 2FA) and `npm dist-tag` (to remove the `commit` dist-tag that npm requires when publishing commit releases).

   > [!NOTE]
   > A new trusted publisher expires if it isn't used within 2 days.
1. (Recommended.) On npmjs.com, go to **Settings** > **Publishing access** and select **Require two-factor authentication and disallow tokens** — trusted publishing keeps working while npm tokens can't publish anymore.

### How it works

The reusable workflow [`publish.yml`](.github/workflows/publish.yml) runs two jobs:

1. **Build & pack** runs `$ pnpm install` and `$ pnpm exec release-me ci-pack` (which builds and packs the packages). This job runs the repository's code, so it isn't allowed to publish to npm — that's why commit-releasing untrusted code (e.g. a pull request from a fork) is safe.
1. **Publish to npm** publishes the tarballs without running any code of the repository. It's the only job allowed to authenticate to npm, and it verifies the tarballs before publishing them: for a stable release, the version must match the Git tag; for a commit release, it must be `x.y.z-commit-${hash}` (a pre-release version, so that semver ranges never match it).

> [!NOTE]
> - Re-running a failed workflow is safe: versions that are already published are skipped.
> - npm [provenance](https://docs.npmjs.com/generating-provenance-statements) is added to stable releases and to commit releases of the tip of a branch (but not to commit releases of other commits, since provenance would point to the wrong commit).
> - Since the release commit (including `pnpm-lock.yaml`) is made before the new version is on npm, packages of your monorepo that depend on the released package (e.g. `examples/`) must get it from the workspace (`workspace:` protocol, or the [`link-workspace-packages`](https://pnpm.io/settings#linkworkspacepackages) setting) — otherwise updating `pnpm-lock.yaml` fails and the release is aborted.
