# `@brillout/release-me`

Publish your npm packages.

Used by:
- Vike
- Telefunc
- Packages made by [`brillout`](https://github.com/brillout)
- Packages made by [`magne4000`](https://github.com/magne4000)

[Features](#features)  
[Installation](#installation)  
[Usage](#usage)  

> [!WARNING]
> Don't use this: it's only meant for Vike's team & friends. That said, feel free to fork this project.

<br/>


## Features

- Automatically generates and updates `CHANGELOG.md`.
- Automatic monorepo support.
- Generates Git tags.
- Pre-release support.
- Asks for confirmation before publishing, and shows a preview of the changes (e.g. to `CHANGELOG.md`) enabling you to double check before publishing.

<br/>


## Installation

### Basics

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

That's all `@brillout/release-me` needs: you can now use `pnpm exec release-me patch` to release a new patch version.

### Scripts

It's optional but we recommend adding `package.json#scripts`:

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

It's a ubiquitous convention: it communicates how new versions are released to anyone who's discovering your project.

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
