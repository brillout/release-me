# `@brillout/release-me`

Publish your npm packages.

Used by:
- Vike
- Telefunc
- `@brillout/*`

> [!WARNING]
> Don't use this: it isn't meant for others to use. That said, feel free to fork this project.

<br/>

## Features

- Automatically generates and updates `CHANGELOG.md`.
- Automatic monorepo support.
- Generates Git tags.
- Pre-release support.
- Asks for confirmation before publishing, and shows a preview of the changes (e.g. to `CHANGELOG.md`) enabling you to double check before publishing.

<br/>

## Installation

```json5
// package.json
{
  "name": "my-package",
  "version": "0.1.2",
  "scripts": {
    "build": "echo 'I am used by release-me'",
    "release": "release-me patch",
    "release:minor": "release-me minor",
    "release:commit": "release-me commit"
  },
  "devDependencies": {
    "@brillout/release-me": "^0.3.8"
  }
}
```

> [!NOTE]
> Installation examples:
>  - [GitHub > vikejs/vike](https://github.com/vikejs/vike) (single package)
>  - [GitHub > vikejs/vike-react](https://github.com/vikejs/vike-react) (monorepo)

<br/>

## Usage

Release new patch/minor/major version:

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
> For a slight DX improvement, we recommend defining `package.json#scripts` and use `$ pnpm run` instead of `$ pnpm exec`.


Release specific version:

```shell
pnpm exec release-me v0.1.2
```

You can also publish pre-releases such as [`0.4.177-commit-ff3d6cd`](https://www.npmjs.com/package/vike/v/0.4.177-commit-ff3d6cd):

```shell
pnpm exec release-me commit
```
