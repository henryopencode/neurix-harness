# Desktop releases

English | [中文](releasing.zh.md)

## Summary

Develop on `develop` and merge a stable change into `master` through a pull request. That merge reserves a version, builds Windows x64, macOS arm64, macOS x64, and Linux x64 installers, and publishes one complete GitHub Release. Ordinary development uploads run checks without creating installers.

## Table of Contents

- [Development and release](#development-and-release)
- [Versions and retries](#versions-and-retries)
- [Installed update checks](#installed-update-checks)
- [Dev Note](#dev-note)

<a id="development-and-release"></a>
## Development and release

`develop` is the default development branch. The **Neurix development checks** workflow validates pushes to it and pull requests to either branch. It runs the build, lint, and unit tests. The repository's upstream-specific automated workflows are disabled in this fork; their files remain available for reference.

Open a pull request from this repository's `develop` to `master` when the changes are ready. **Neurix stable desktop release** responds only after that pull request merges. Closing without merging, merging another branch, and direct pushes do not publish installers. All four platform jobs must succeed before a Release appears. Each installer includes the application and its matching runtime. GitHub Releases also contains `SHA256SUMS.txt` for the installers and the Linux Web server archive.

The installers use no release-signing secrets: Windows is unsigned, macOS uses ad-hoc signing without notarization, and Linux uses AppImage. They do not connect to the upstream automatic-update service. Developer ID signing and notarization are prerequisites for reliable unattended macOS replacement.

<a id="versions-and-retries"></a>
## Versions and retries

The first release is `1.0.0`; later stable releases increment the patch. A deliberately higher stable manifest version, or the workflow's explicit version input, selects a minor or major release. The automation aligns the dsh workspace manifests and lockfile in one version commit on `master`, then atomically pushes it with `v<version>` and `dsh-v<version>` tags. Vendored and native package versions retain their independent sequences.

Version reservation uses the latest `master` so a concurrent merge cannot be overwritten. The version commit records the triggering merge; retrying that workflow reuses its immutable tags. If a platform fails, fix the failure before another stable merge, or rerun the failed jobs for a transient infrastructure failure. A reserved version is not reused for different source. A published Release is not overwritten.

For a build rehearsal, run the release workflow manually with **validation_only** enabled. Select a platform or all platforms; it builds the selected branch and uploads Actions artifacts without writing versions, tags, or Releases. Manual publication requires selecting `master` and disabling **validation_only**. To inspect local version selection without changes, run:

```sh
pnpm exec tsx scripts/release/desktop-stable.ts --plan
```

<a id="installed-update-checks"></a>
## Installed update checks

Install a package that includes this update checker once. It checks this repository's latest stable GitHub Release at startup, periodically, and through the existing update menu. Drafts and prereleases are excluded. A new version appears in the existing update indicator; **Download update** opens the installer for the app's operating system and architecture in the browser. Open the downloaded installer to update, retaining settings and conversations.

This download flow leaves the current application running and does not request installation privileges or store a GitHub token. A failed explicit check shows the existing retry action. Before the first Release, no update is offered. Older installations without the checker need one initial manual update.

<a id="dev-note"></a>
## Dev Note

None.
