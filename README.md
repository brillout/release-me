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

Run `$ pnpm add -D @brillout/release-me` and make sure you have the following:

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

### Installation

1. Add `@brillout/release-me` to the `devDependencies` of the monorepo root's `package.json`
2. For each package you want to release via `@brillout/release-me`, add scripts that run `release-me`
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
> A package is considered by `@brillout/release-me` if it defines a script that runs `release-me` (private packages are skipped).

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

Instead of publishing from your machine (which requires npm 2FA), you can let `@brillout/release-me`'s GitHub Action publish releases to npm (without 2FA and without npm secret token).

1. Run `$ pnpm exec release-me init` (it creates `.github/workflows/release.yml` and commits it), then `$ git push`.
1. On [npmjs.com](https://www.npmjs.com), for each package: go to the package's **Settings** (`https://www.npmjs.com/package/${packageName}/access`) and, under **Trusted Publisher**, press **GitHub Actions**:
   - **Organization or user** / **Repository**: your GitHub repository
   - **Workflow filename**: `release.yml`
   - **Allowed actions**: **[x] Allow `npm publish`** and **[x] Allow `npm dist-tag`**
   - **Confirm**: click `Set up connection`

> [!NOTE]
> It uses [npm's trusted publishing](https://docs.npmjs.com/trusted-publishers).

> [!NOTE]
> Stable releases get npm [provenance](https://docs.npmjs.com/generating-provenance-statements), commit releases don't.
