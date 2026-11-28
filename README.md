# `@brillout/release-me`

Publish your npm packages.

[Features](#features)  
[Get started](#get-started)  
[Conventional Commits](#conventional-commits)  
&nbsp;&nbsp;&nbsp;&nbsp;[Monorepo](#monorepo)  
[GitHub Actions](#github-actions)  
&nbsp;&nbsp;&nbsp;&nbsp;[Npm Release](#npm-release)  
&nbsp;&nbsp;&nbsp;&nbsp;[GitHub Release](#github-release)  
[CLI](#cli)  

<br/>

## Features

- Monorepo support.
- Can publish via a GitHub Action instead of your machine: no npm login/2FA/token needed. (See [GitHub Actions > Npm Release](#npm-release).)
- Generates `CHANGELOG.md` from your commits. (See [Conventional Commits](#conventional-commits).)
  - Keeps GitHub Releases in sync with `CHANGELOG.md`. (See [GitHub Actions > GitHub Release](#github-release).)
- Creates the release commit and its Git tag.
  - Shows a preview of the changes made to `package.json` and `CHANGELOG.md`, and asks for confirmation before releasing.
- Commit releases: publish any commit as a pre-release, e.g. [`0.4.177-commit-ff3d6cd`](https://www.npmjs.com/package/vike/v/0.4.177-commit-ff3d6cd).
- Updates the `const PROJECT_VERSION = '0.1.2'` of `PROJECT_VERSION.ts` files.
- Only supports [`pnpm`](https://pnpm.io) with tight integration (it's a feature, not a limitation).

<br/>

## Get started

1. Install `@brillout/release-me` (at your repository's root `package.json`):

   ```shell
   pnpm add -D @brillout/release-me
   ```

2. Make sure your `package.json` defines a `build` script (`@brillout/release-me` runs it before releasing):

   ```diff
    // package.json
    {
      "name": "my-package",
      "version": "0.0.0",
      "scripts": {
   +    "build": "echo 'Build step before releasing'"
      }
    }
   ```

3. Add `release` scripts:

   ```diff
    // package.json
    {
      "name": "my-package",
      "version": "0.0.0",
      "scripts": {
        "build": "echo 'Build step before releasing'",
   +    "release": "release-me patch",
   +    "release:minor": "release-me minor",
   +    "release:major": "release-me major",
   +    "release:commit": "release-me commit"
      }
    }
   ```

   > ℹ️  **Monorepo**
   >
   > Add them (and a `build` script) to each package you want to release:
   >
   > ```diff
   >  // packages/my-package/package.json
   >  {
   >    "name": "my-package",
   >    "version": "0.0.0",
   >    "scripts": {
   >      "build": "echo 'Build step before releasing'",
   > +    "release": "pnpm --recursive --sequential run release --yes",
   > +    "release:minor": "pnpm --recursive --sequential run release:minor --yes",
   > +    "release:major": "pnpm --recursive --sequential run release:major --yes",
   > +    "release:commit": "pnpm --recursive --sequential run release:commit --yes",
   >    }
   >  }
   > ```
   >
   > 👉 A package is released by `@brillout/release-me` if and only if it defines a script that runs `release-me`.
   >
   > To release all packages at once, add `release` scripts to the monorepo root's `package.json`:
   >
   > ```diff
   >  // package.json (monorepo root)
   >  {
   >    "scripts": {
   > +    "release": "pnpm --recursive --sequential run release --yes",
   > +    "release:minor": "pnpm --recursive --sequential run release:minor --yes",
   > +    "release:major": "pnpm --recursive --sequential run release:major --yes",
   > +    "release:commit": "pnpm --recursive --sequential run release:commit --yes",
   >    }
   >  }
   > ```

4. Set up [`@brillout/release-me`'s  GitHub Actions](#github-actions):

   ```shell
   pnpm exec release-me init
   ```

5. From now on, make sure to follow [Conventional Commits](#conventional-commits) for correct `CHANGELOG.md` generation.

<br/>

## Conventional Commits

Follow Conventional Commits ([conventionalcommits.org](https://www.conventionalcommits.org)), so that `@brillout/release-me` can generate `CHANGELOG.md` using your commit messages:

- `fix:` => bug fix or some polishing (e.g. improved error message).
- `feat:` => new feature, i.e. new functionality.

For breaking changes, append `BREAKING CHANGE:` to the commit message:

```
fix: make someFunction() take an argument object

BREAKING CHANGE: Replace `someFunction(someArg)` with `someFunction({ someArg })`.
```

> ℹ️  **Versioning breaking changes**
>
> When introducing a breaking change, in order to respect the [semver](https://semver.org) convention, don't `$ pnpm exec release-me patch` but `$ pnpm exec release-me major` instead (or `$ pnpm exec release-me minor` if your package's version is `0.y.z`).

### Monorepo

Each package has its own `CHANGELOG.md` (`packages/my-package/CHANGELOG.md`), with the following commits:

- If the commit has a scope (e.g. `fix(some-package): some commit`), it is included only if the scope matches the package's `package.json#name`.
- If the commit has no scope (e.g. `fix: some commit`), it is included only if it modifies a file within the package's root directory (i.e. the directory where the package's `package.json` lives).

> ℹ️  **Root changelog**
>
> If the repository has only one package and `CHANGELOG.md` already exists at the monorepo root, then `CHANGELOG.md` lives at the monorepo root.

<br/>

## GitHub Actions

`$ pnpm exec release-me init` sets up both GitHub Actions of `@brillout/release-me`:
- [Npm Release](#npm-release) (`.github/workflows/release-npm.yml`) publishes to npm.
- [GitHub Release](#github-release) (`.github/workflows/release-github.yml`) keeps GitHub Releases in sync with `CHANGELOG.md`.

> ℹ️  **Setting up a single action**
>
> To set up only one of them, use `--npm` or `--github`.

### Npm Release

Instead of publishing from your machine (which requires npm 2FA), you can let `@brillout/release-me`'s GitHub Action publish to npm (without 2FA and without an npm secret token):

```shell
pnpm exec release-me init --npm
```

> ℹ️  **Publishing a commit release**
>
> To make a commit-release:
> - Run `$ pnpm exec release-me commit` to commit-release the current commit (i.e. `$ git show HEAD`), or
> - press the **Run workflow** button of the GitHub Action `release-npm.yml`.

> [!WARNING]
> - Only commit-release commits you trust (e.g. review a pull request before commit-releasing it)
> - Anyone with write access can publish: only give repository write access to people you trust

> ℹ️  **Trusted publishing and provenance**
>
> - The GitHub Action `release-npm.yml` uses [npm's trusted publishing](https://docs.npmjs.com/trusted-publishers)
> - Stable releases get npm [provenance](https://docs.npmjs.com/generating-provenance-statements), commit releases don't

### GitHub Release

You can let `@brillout/release-me`'s GitHub Action synchronize your GitHub Releases with `CHANGELOG.md`:

```shell
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

To trigger the first sync, manually trigger the action by running:

```shell
pnpm exec release-me github-release-sync
```

> ℹ️  **First sync**
>
> The first sync creates A LOT of GitHub Releases: one for every version listed in `CHANGELOG.md`.

> ℹ️  **Editing release notes**
>
> `CHANGELOG.md` is the source of truth: **upon each push of a `CHANGELOG.md` change to `main`, GitHub Releases are created, updated, and deleted to match exactly `CHANGELOG.md`**. Always edit `CHANGELOG.md` instead of a GitHub Release: the next sync overwrites any edit made to a GitHub Release.

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
pnpm exec release-me npm-connection  # Show and fix the npm <=> GitHub connection of each package (npm's trusted publisher)
```

> ℹ️  **Commit releases**
>
> A commit release doesn't change your repository (no release commit, no Git tag), and it has no npm dist-tag.
