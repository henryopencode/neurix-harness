# Desktop releases

English | [中文](releasing.zh.md)

## Summary

Develop on `develop` and merge a stable change into `master` through a pull request. That merge reserves a version, builds Windows x64, macOS arm64, macOS x64, and Linux x64 installers, and publishes one complete GitHub Release. Ordinary development uploads run checks without creating installers.

## Table of Contents

- [Development and release](#development-and-release)
- [Versions and retries](#versions-and-retries)
- [Installed update checks](#installed-update-checks)
- [Server updates](#server-updates)
- [Dev Note](#dev-note)

<a id="development-and-release"></a>
## Development and release

`develop` is the default development branch. The **Neurix development checks** workflow validates pushes to it and pull requests to either branch. It runs the build, lint, and unit tests. The repository's upstream-specific automated workflows are disabled in this fork; their files remain available for reference.

Open a pull request from this repository's `develop` to `master` when the changes are ready. **Neurix stable desktop release** responds only after that pull request merges. Closing without merging, merging another branch, and direct pushes do not publish installers. All four platform jobs must succeed before a Release appears. Uploads remain a draft until all assets and checksums are present; publication uses GitHub's semantic version ordering so an older build finishing late cannot replace the newest version. Each installer includes the application and its matching runtime. GitHub Releases also contains `SHA256SUMS.txt` for the installers and the Linux Web server archive.

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

Install a package with the in-app update controls once. It checks this repository’s latest stable GitHub Release at startup, periodically, and through the update menu; drafts and prereleases are excluded. A download icon above Settings starts the matching installer transfer. Its ring shows byte progress and its stop action cancels the transfer and removes partial files. The complete installer must match the release asset size and `SHA256SUMS.txt` before installation becomes available. Windows confirms task interruption before starting the per-user installer and reopening the app. macOS opens the downloaded DMG for manual replacement; Linux Desktop reveals its AppImage. Settings and conversations stay in their existing data directories.

This download flow leaves the current application running and does not request installation privileges or store a GitHub token. A failed explicit check shows the existing retry action. Before the first Release, no update is offered. Older installations without the checker need one initial manual update.

<a id="server-updates"></a>
## Server updates

The Linux deployment uses a separate systemd updater from [`scripts/deploy`](../scripts/deploy/server-update.py). Its timer checks this repository's latest published stable Release every ten minutes. It verifies the server archive against `SHA256SUMS.txt`; drafts, prereleases, and incomplete asset sets are rejected. Development builds remain explicitly installed snapshots.

The private update-control plugin reports active Agents, queued input, and background jobs over a mode-0600 Unix socket. An update waits for idle work, locks new API admission, and drains accepted requests. Installation then shows a temporary maintenance response, stops the service, and backs up its Harness home before switching the program directory. The replacement must report its version and readiness before clients reconnect. A failed startup restores the previous program and the saved home; the failed version remains held for operator review. Workspace files remain in their existing directory.

The service, timer, control overlay, and deployment paths are supplied beside the updater. After installing them, run `python3 /etc/neurix-agent/server-update.py` to check without installing, or `systemctl start neurix-agent-update.service` to request the next idle update. `/opt/neurix-agent/update-status.json` and the updater service's journal record the result. The updater downloads and inspects packages as data; it executes no downloaded code as root.

<a id="dev-note"></a>
## Dev Note

None.
