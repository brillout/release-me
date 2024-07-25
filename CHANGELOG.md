# [0.4.0](https://github.com/brillout/release-me/compare/v0.3.10...v0.4.0) (2024-07-25)


### Bug Fixes

* only replace PROJECT_VERSION inside package files ([5a3721a](https://github.com/brillout/release-me/commit/5a3721a5c63263b087c37b3f869e3a343cd0a7d5))
* update PROJECT_VERSION inside PROJECT_VERSION.ts instead of ([6f59842](https://github.com/brillout/release-me/commit/6f59842042da4a9526c0598a5a303732d2944ae3))


### BREAKING CHANGES

* rename projectInfo.ts to PROJECT_VERSION.ts



## [0.3.10](https://github.com/brillout/release-me/compare/v0.3.9...v0.3.10) (2024-07-25)


### Bug Fixes

* improve PROJECT_VERSION handling ([4bd7dd2](https://github.com/brillout/release-me/commit/4bd7dd2160a11d7e328e428c25e3d244784ee268))



## [0.3.9](https://github.com/brillout/release-me/compare/v0.3.8...v0.3.9) (2024-05-28)


### Bug Fixes

* fix first usage ([43906a0](https://github.com/brillout/release-me/commit/43906a05dd6ba4ae0826be63c0eff4ff7dccd1ce))



## [0.3.8](https://github.com/brillout/release-me/compare/v0.3.7...v0.3.8) (2024-05-27)


### Bug Fixes

* also clean git tag ([04094fc](https://github.com/brillout/release-me/commit/04094fcdfe3e0bdcb02cf96287d97967820a0be0))
* also clean upon error ([734c75a](https://github.com/brillout/release-me/commit/734c75afa46dbccfd66d8671ba30b15b430e75c5))
* avoid infinite clean loop ([230db97](https://github.com/brillout/release-me/commit/230db97d6179e31085b2073a57dfebe9bcf2dc19))
* fix error catch ([db16061](https://github.com/brillout/release-me/commit/db160616fc92d694ca3327c00cd982c29c14f7e5))
* fix release reverting ([0786cb2](https://github.com/brillout/release-me/commit/0786cb29e546fdc243d4adf8fa554b6054d6149c))
* improve err msg ([29c987e](https://github.com/brillout/release-me/commit/29c987e032654ae187a4d07db77fd9c47be27196))
* only revert if there are uncommitted changes ([062c285](https://github.com/brillout/release-me/commit/062c285303eed1c52617c04afc7ef7ea99d5314a))
* use more reliable origin/main check ([3fa1829](https://github.com/brillout/release-me/commit/3fa1829a51fa72dd79838bb58457759385b39125))



## [0.3.7](https://github.com/brillout/release-me/compare/v0.3.6...v0.3.7) (2024-04-24)


### Bug Fixes

* improve logging ([45281ff](https://github.com/brillout/release-me/commit/45281ffe1bc23549a6bbb4679e7485ee7ae4a972))
* re-use undo logic ([26288b3](https://github.com/brillout/release-me/commit/26288b314cda5f45cfe7903bfc4ad8f53b901ede))



## [0.3.6](https://github.com/brillout/release-me/compare/v0.3.5...v0.3.6) (2024-04-24)


### Bug Fixes

* minor logging fix ([9adf4aa](https://github.com/brillout/release-me/commit/9adf4aa6c15f80c305cb1a385fcdefc471085294))



## [0.3.5](https://github.com/brillout/release-me/compare/v0.3.4...v0.3.5) (2024-04-24)


### Bug Fixes

* improve logging ([5f5b531](https://github.com/brillout/release-me/commit/5f5b5317039214445b9bf20cfebc8876e1fda79b))



## [0.3.4](https://github.com/brillout/release-me/compare/v0.3.3...v0.3.4) (2024-04-23)


### Bug Fixes

* re-enable empty release commits ([872f979](https://github.com/brillout/release-me/commit/872f979c4c3ca942f941bd3dca2e35fd5e4a665b))



## [0.3.3](https://github.com/brillout/release-me/compare/v0.3.2...v0.3.3) (2024-04-23)


### Bug Fixes

* always use --no-pager ([b8e8d0d](https://github.com/brillout/release-me/commit/b8e8d0d701293fdc210a3d2fd67d9da55dc33939))
* fix changelog preview ([169853b](https://github.com/brillout/release-me/commit/169853b9fee5354881228ae80454a2d934b4d92b))



## [0.3.2](https://github.com/brillout/release-me/compare/v0.3.1...v0.3.2) (2024-04-23)


### Bug Fixes

* swallow git fetch "error" ([08c8611](https://github.com/brillout/release-me/commit/08c8611756f0af109bd36c9d836512b726030622))



## [0.3.1](https://github.com/brillout/release-me/compare/v0.3.0...v0.3.1) (2024-04-23)


### Bug Fixes

* CHANGELOG.md path ([1d6dc10](https://github.com/brillout/release-me/commit/1d6dc1080230c4652c84b48f59ad18b9b7647dbb))
* fix monorepo analysis ([97239b3](https://github.com/brillout/release-me/commit/97239b3d73c070b5c3269f9676c4a2e864468b82))
* improve analysis log ([f9b3347](https://github.com/brillout/release-me/commit/f9b334798cf21e7109b78524ecef19ae8fd2b212))
* improve err msg ([f4bd1b8](https://github.com/brillout/release-me/commit/f4bd1b85aa1eea53a583456f19475036f97f5818))
* minor err msg improvement ([f5fab4f](https://github.com/brillout/release-me/commit/f5fab4f6652c72a51c552836702d54f732b5377b))
* use git ls-files instead of pnpm-workspace.yaml ([6ed5e1d](https://github.com/brillout/release-me/commit/6ed5e1d27ad56b31314dac1e5529f3de9117840e))



# [0.3.0](https://github.com/brillout/release-me/compare/v0.2.4...v0.3.0) (2024-04-22)


### Bug Fixes

* improve CLI help ([bd50ff8](https://github.com/brillout/release-me/commit/bd50ff8af9ee1466e5ca36654ac8c703bf89110e))
* remove --dev ([5653ce2](https://github.com/brillout/release-me/commit/5653ce29e51803c685cc12fd495c02ff45858b24))


### Features

* remove --git-tag-prefix arg; automatically determine it ([dec181a](https://github.com/brillout/release-me/commit/dec181a2b6cba9c2e63750035975b99dcc59e2a1))


### BREAKING CHANGES

* remove superfluous/unused CLI arguments


## [0.2.4](https://github.com/brillout/release-me/compare/v0.2.3...v0.2.4) (2024-04-22)


### Bug Fixes

* improve err msg ([09af76d](https://github.com/brillout/release-me/commit/09af76dcff05e7990b396c81a3bfbe517e426604))
* improve err msgs ([00523b6](https://github.com/brillout/release-me/commit/00523b687291a3f5e25418e4a657601fc14c42d4))
* make clean safe ([ad67e88](https://github.com/brillout/release-me/commit/ad67e88e5e1af450dd20756fdb6a392cf05d893c))



## [0.2.3](https://github.com/brillout/release-me/compare/v0.2.2...v0.2.3) (2024-04-22)


### Bug Fixes

* clean upon error or ctrl-c ([e1b84b5](https://github.com/brillout/release-me/commit/e1b84b54e7724f9ca05a3c65d3172d4f2fa8a31a))
* log analysis result ([9cc50ee](https://github.com/brillout/release-me/commit/9cc50ee8d3baf155a12ef5736aea9bf222afcb7d))
* show CHANGELOG.md content upon creating ([3bfb168](https://github.com/brillout/release-me/commit/3bfb1689e60d695a03fddcf01599a8e9b3ca76d1))



