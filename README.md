# `@brillout/release-me`

Publish your npm packages.

[Features](#features)  
[Get started](#get-started)  
[Conventional Commits](#conventional-commits)  
[GitHub Actions](#github-actions)  
&nbsp;&nbsp;&nbsp;&nbsp;[Npm Release](#npm-release)  
&nbsp;&nbsp;&nbsp;&nbsp;[GitHub Release](#github-release)  
[CLI](#cli)  

<br/>

## Features

- Monorepo support
- Can publish via a GitHub Action instead of your machine: no npm login/2FA/token needed (see [GitHub Actions > Npm Release](#npm-release))
- Creates: release Git commit & Git tag, `CHANGELOG.md`,  GitHub Release (see [GitHub Actions > GitHub Release](#github-release))
- Shows a preview of the release, and asks for confirmation before releasing
- "Commit releases": publish any commit as a pre-release, e.g. [`0.4.177-commit-ff3d6cd`](https://www.npmjs.com/package/vike/v/0.4.177-commit-ff3d6cd)
- Updates `const PROJECT_VERSION = '0.1.2'` of `PROJECT_VERSION.ts` files
- Only supports [`pnpm`](https://pnpm.io) with tight integration (it's a feature, not a bug)

<br/>

## Get started

1. Install:

   ```shell
   pnpm add -D @brillout/release-me
   ```

   > ℹ️  **Monorepo**
   >
   > Install it at your repository root.

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

   > ℹ️  **Monorepo**
   >
   > Make sure it's defined for every package you want to release.

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

   > ℹ️  **Commit releases**
   >
   > Run `pnpm run release:commit` to publish the current commit to npm as a pre-release `my-package@1.2.3-commit-abc1234`.
   >
   > With the [Release Npm GitHub Action](#npm-release), you can also use the **Run workflow** button on GitHub instead.
   >
   > ⚠️ **Only commit-release commits you trust** (e.g. review a pull request before commit-releasing it).

   > ℹ️  **Monorepo**
   >
   > Add them to each package you want to release: a package is released by `@brillout/release-me` if and only if it defines a script that runs `release-me`.
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

That's it.

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

> [!NOTE]
> If the repository has only one package, `CHANGELOG.md` can live either at the repository root or inside the directory containing the package's `package.json` file. (You can move it, and @brillout/release-me will pick it up.)

> [!NOTE]
> When introducing a breaking change, in order to respect the [semver](https://semver.org) convention, don't `$ pnpm exec release-me patch` but `$ pnpm exec release-me major` instead (or `$ pnpm exec release-me minor` if your package's version is `0.y.z`).

### Monorepo

Each package has its own `CHANGELOG.md` (`packages/my-package/CHANGELOG.md`), with the following commits:

- If the commit has a scope (e.g. `fix(some-package): some commit`), it is included only if the scope matches the package's `package.json#name`.
- If the commit has no scope (e.g. `fix: some commit`), it is included only if it modifies a file within the package's root directory (i.e. the directory where the package's `package.json` lives).

<br/>

## GitHub Actions

You can use two GitHub Actions:
- `.github/workflows/release-npm.yml` => publishes to npm
- `.github/workflows/release-github.yml` => keeps GitHub Releases in sync with `CHANGELOG.md`

### Npm Release

Instead of publishing from your machine (which requires npm 2FA), you can let a GitHub Action publish to npm (without 2FA and without an npm secret token).

To set it up, run the following command which will:
1. Create a `.github/workflows/release-npm.yml` file
2. Set up the Npm <=> GitHub connection ([npm trusted publishing](https://docs.npmjs.com/trusted-publishers))

```shell
pnpm exec release-me init --npm
```

> [!WARNING]
> Anyone with write access can publish: **only give repository write access to people you trust**.

### GitHub Release

You can let a GitHub Action synchronize your GitHub Releases with `CHANGELOG.md`.

To set it up, run the following command which will create a `.github/workflows/release-github.yml` file.

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

> [!NOTE]
> The first sync creates A LOT of GitHub Releases: one for every version listed in `CHANGELOG.md`.

> [!NOTE]
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
