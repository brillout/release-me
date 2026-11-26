# `@brillout/release-me`

Publish your npm packages.

Used by:
- Vike
- Telefunc
- Packages made by [`brillout`](https://github.com/brillout)
- Packages made by [`magne4000`](https://github.com/magne4000)

[Features](#features)  
[Get started](#get-started)  
&nbsp;&nbsp;&nbsp;&nbsp;[Monorepo](#monorepo)  
[CLI](#cli)  
[Conventional Commits](#conventional-commits)  
&nbsp;&nbsp;&nbsp;&nbsp;[Monorepo](#monorepo-1)  
[GitHub Actions](#github-actions)  
&nbsp;&nbsp;&nbsp;&nbsp;[Npm Release](#npm-release)  
&nbsp;&nbsp;&nbsp;&nbsp;[GitHub Release](#github-release)  

> [!WARNING]
> Don't use this: it's only meant for Vike's team & friends. That said, feel free to fork this project.

<br/>

## Features

- Generates `CHANGELOG.md` from your commits. (See [Conventional Commits](#conventional-commits).)
- Creates the release commit and its Git tag.
- Updates the `const PROJECT_VERSION = '0.1.2'` of `PROJECT_VERSION.ts` files.
- Shows a preview of the changes made to `package.json` and `CHANGELOG.md`, and asks for confirmation before releasing.
- Commit releases: publish any commit as a pre-release, e.g. [`0.4.177-commit-ff3d6cd`](https://www.npmjs.com/package/vike/v/0.4.177-commit-ff3d6cd).
- Monorepo support. (See [Monorepo](#monorepo).)
- Can publish via a GitHub Action instead of your machine: no npm login/2FA/token needed. (See [Npm Release](#npm-release).)
- Keeps GitHub Releases in sync with `CHANGELOG.md`. (See [GitHub Release](#github-release).)

<br/>

## Get started

1. Add `@brillout/release-me` to the `devDependencies` of your repository's root `package.json`, and add the following scripts (`@brillout/release-me` runs the `build` script before releasing):

   ```shell
   pnpm add -D @brillout/release-me
   ```

   ```diff
    // package.json
    {
      "name": "my-package",
      "version": "0.1.2",
      "scripts": {
   +    "build": "echo 'Build step before releasing'",
   +    "release": "release-me patch",
   +    "release:minor": "release-me minor",
   +    "release:major": "release-me major",
   +    "release:commit": "release-me commit"
      },
      "devDependencies": {
        "@brillout/release-me": "^0.6.0"
      }
    }
   ```

2. Set up the GitHub Actions of `@brillout/release-me` (see [GitHub Actions](#github-actions)):

   ```shell
   # Run, then follow the steps it prints
   pnpm exec release-me init
   ```

That's it: `$ pnpm run release` releases a new patch version (see [CLI](#cli)).

### Monorepo

1. Add `@brillout/release-me` to the `devDependencies` of the monorepo root's `package.json`.
2. Add the `release` scripts to each package you want to release:
   ```diff
    // packages/my-package/package.json
    {
      "name": "my-package",
      "version": "0.1.2",
      "scripts": {
   +    "release": "release-me patch",
   +    "release:minor": "release-me minor",
   +    "release:major": "release-me major",
   +    "release:commit": "release-me commit"
      }
    }
   ```

> [!NOTE]
> A package is released by `@brillout/release-me` if and only if it defines a script that runs `release-me`.

To release all packages at once, add `release` scripts to the monorepo root's `package.json`:

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

<br/>

## CLI

```shell
pnpm exec release-me patch           # Release a new patch version (0.1.2 => 0.1.3)
pnpm exec release-me minor           # Release a new minor version (0.1.2 => 0.2.0)
pnpm exec release-me major           # Release a new major version (0.1.2 => 1.0.0)
pnpm exec release-me v0.1.5          # Release a specific version
pnpm exec release-me commit          # Release the current commit (0.1.2-commit-ff3d6cd)
pnpm exec release-me patch --yes     # Skip the confirmation
pnpm exec release-me patch --force   # Release even in unexpected situations (e.g. from another branch than main, or without CHANGELOG.md entry)
```

> [!NOTE]
> A commit release doesn't change your repository (no release commit, no Git tag), and it has no npm dist-tag: installing it requires its exact version, e.g. `$ pnpm add my-package@0.1.2-commit-ff3d6cd`.

<br/>

## Conventional Commits

`@brillout/release-me` generates `CHANGELOG.md` from your commits: follow [Conventional Commits](https://www.conventionalcommits.org).

- `fix:` => bug fix or some polishing (e.g. improved error message).
- `feat:` => new feature, i.e. new functionality.

For breaking changes, append `BREAKING CHANGE:` to the commit message:

```
fix: make someFunction() take an argument object

BREAKING CHANGE: Replace `someFunction(someArg)` with `someFunction({ someArg })`.
```

> [!NOTE]
> When introducing a breaking change, in order to respect the [semver](https://semver.org/) convention, don't `$ pnpm exec release-me patch` but `$ pnpm exec release-me major` instead (or `$ pnpm exec release-me minor` if your package's version is `0.y.z`).

### Monorepo

Each package has its own `CHANGELOG.md` (`packages/my-package/CHANGELOG.md`), with the following commits:

- If the commit has a scope (e.g. `fix(some-package): some commit`), it is included only if the scope matches the package's `package.json#name`.
- If the commit has no scope (e.g. `fix: some commit`), it is included only if it modifies a file within the package's root directory (i.e. the directory where the package's `package.json` lives).

> [!NOTE]
> If the repository has only one package and `CHANGELOG.md` already exists at the monorepo root, then `CHANGELOG.md` lives at the monorepo root.

<br/>

## GitHub Actions

`$ pnpm exec release-me init` sets up both GitHub Actions of `@brillout/release-me`:
- [Npm Release](#npm-release) (`.github/workflows/release-npm.yml`) publishes to npm.
- [GitHub Release](#github-release) (`.github/workflows/release-github.yml`) keeps GitHub Releases in sync with `CHANGELOG.md`.

To set up only one of them, use `--npm` or `--github`.

### Npm Release

Instead of publishing from your machine (which requires npm 2FA), you can let `@brillout/release-me`'s GitHub Action publish to npm (without 2FA and without an npm secret token):

```shell
# Creates .github/workflows/release-npm.yml (run, then follow the steps it prints)
pnpm exec release-me init --npm
```

> [!NOTE]
> To make a commit-release:
> - Run `$ pnpm exec release-me commit` to commit-release the current commit (i.e. `$ git show HEAD`), or
> - press the **Run workflow** button of the GitHub Action `release-npm.yml`.

> [!WARNING]
> - Only commit-release commits you trust (e.g. review a pull request before commit-releasing it)
> - Anyone with write access can publish: only give repository write access to people you trust

> [!NOTE]
> - The GitHub Action `release-npm.yml` uses [npm's trusted publishing](https://docs.npmjs.com/trusted-publishers)
> - Stable releases get npm [provenance](https://docs.npmjs.com/generating-provenance-statements), commit releases don't

### GitHub Release

You can let `@brillout/release-me`'s GitHub Action synchronize your GitHub Releases with `CHANGELOG.md`:

```shell
# Creates .github/workflows/release-github.yml
pnpm exec release-me init --github
```

<details>
<summary>Debug commands</summary>

Preview the changes without making them:

```shell
pnpm exec release-me github-release-sync --dry-run
```

Sync only some packages (by name or directory):

```shell
pnpm exec release-me github-release-sync some-package packages/another-package
```

Delete all GitHub Releases of the repository (`CHANGELOG.md` and Git tags are kept, so that `github-release-sync` can re-create them):

```shell
pnpm exec release-me github-release-delete-all
```

Run locally, these commands use the environment variable `GITHUB_TOKEN`, or else the token of the GitHub CLI `gh` (`$ gh auth login`). Without `--dry-run`, the token needs write access to the repository's contents.

</details>

> [!NOTE]
> `CHANGELOG.md` is the source of truth: upon each push of a `CHANGELOG.md` change to `main`, GitHub Releases are created, updated, and deleted to match exactly `CHANGELOG.md`. Always edit `CHANGELOG.md` instead of a GitHub Release: the next sync overwrites any edit made to a GitHub Release.

> [!NOTE]
> The first sync creates A LOT of GitHub Releases: one for every version listed in `CHANGELOG.md`.

> [!NOTE]
> To sync manually, press the **Run workflow** button of the GitHub Action `release-github.yml`.
