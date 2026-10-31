# Desktop releases

English | [中文](releasing.zh.md)

## Summary

Develop on `develop` and merge a stable change into `master` through a pull request. That merge reserves a version, builds Windows x64, macOS arm64, macOS x64, and Linux x64 installers, and publishes one complete GitHub Release. Ordinary development uploads run checks without creating installers.

## Table of Contents

- [Development and release](#development-and-release)
- [Versions and retries](#versions-and-retries)
- [Installed update checks](#installed-update-checks)
- [Server updates](#server-updates)
- [Production release and deployment SOP](#production-release-sop)
- [Dev Note](#dev-note)

<a id="development-and-release"></a>
## Development and release

`develop` is the default development branch. The **Neurix development checks** workflow validates pushes to it and pull requests to either branch. It runs the build, lint, and unit tests. The repository's upstream-specific automated workflows are disabled in this fork; their files remain available for reference.

Merge the ready changes into `master`. **Neurix stable desktop release** responds to master pushes, including ordinary merges, squash merges, and direct pushes. Development-branch pushes and closing a pull request without merging do not publish installers. All four platform jobs must succeed before a Release appears. Uploads remain a draft until all assets and checksums are present; publication uses GitHub's semantic version ordering so an older build finishing late cannot replace the newest version. Each installer includes the application and its matching runtime. GitHub Releases also contains `SHA256SUMS.txt` for the installers and the Linux Web server archive.

The installers use no release-signing secrets: Windows is unsigned, macOS uses ad-hoc signing without notarization, and Linux uses AppImage. They do not connect to the upstream automatic-update service. Operating-system security policy can still block unsigned installers; signing and notarization remain release-quality requirements.

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

Install a package that includes this update checker once. It checks this repository's latest stable GitHub Release at startup, every ten minutes with bounded jitter, when returning to the foreground or resuming after the next check is due, and through the update menu. Drafts and prereleases are excluded. The bottom-left update action downloads the installer for the operating system and architecture with progress and cancellation. Asset size and SHA-256 must match before **Install and restart** is offered. Settings and conversations remain in their existing directories.

Installation separately confirms interruption of active tasks and completes Host shutdown. Windows starts the per-user NSIS installer with relaunch requested. macOS stages and verifies the DMG application beside the installed app; Linux stages an executable AppImage beside the running AppImage. A detached worker waits for the app process to exit, replaces it, and requests relaunch. Promotion or launch-handoff failure restores the old app. Its backup remains until the new version completes Host startup; an unresponsive new runtime requires operator recovery. Application backups do not restore migrated user data. The install directory must be writable. Network failures retain an explicit retry; failed downloads do not retry automatically. Before the first published stable Release, no update is offered. Older installations without this checker need one initial manual update; source development runs are not replaced.

<a id="server-updates"></a>
## Server updates

The Linux deployment uses a separate systemd updater from [`scripts/deploy`](../scripts/deploy/server-update.py). Its timer checks this repository's latest published stable Release every ten minutes. It verifies the server archive against `SHA256SUMS.txt`; drafts, prereleases, and incomplete asset sets are rejected. Development builds remain explicitly installed snapshots.

The private update-control plugin reports active Agents, queued input, and background jobs over a mode-0600 Unix socket. An update waits for idle work, locks new API admission, and drains accepted requests. Installation then shows a temporary maintenance response, stops the service, and backs up its Harness home before switching the program directory. The replacement must report its version and readiness before clients reconnect. A failed startup restores the previous program and the saved home; the failed version remains held for operator review. Workspace files remain in their existing directory.

The service, timer, control overlay, and deployment paths are supplied beside the updater. After installing them, run `python3 /etc/neurix-agent/server-update.py` to check without installing, or `systemctl start neurix-agent-update.service` to request the next idle update. `/opt/neurix-agent/update-status.json` and the updater service's journal record the result. Extraction preserves archive permissions despite the updater's private umask and keeps the implicit runtime parent traversable; downloaded code never executes as root. After diagnosing a held release and validating a fix, an operator may retry its verified archive with `--archive`, `--version`, and `--sha256`, retaining the failure record and backups. Only a successful installation clears the held version.

<a id="production-release-sop"></a>
## Production release and deployment SOP

Every stable release and online deployment follows this sequence. The release owner records the source commit, version, workflow URL, checksums, platform results, deployed version, and recovery outcome. Missing evidence remains pending; a validation-only build is not a published release, and a successful download is not a completed installation.

1. **Prepare:** use a clean release checkout, inspect the complete change, and run the evidence selected by [pre-push checks](../.agents/skills/dsh-pre-push-checks/SKILL.md). Keep local build and deployment snapshots outside the source checkout used for validation. Fix relevant failures before merging; record unavailable signing or platform evidence explicitly.
2. **Build:** merge into `master` and follow the stable-release workflow. All platform jobs must build and verify the same reserved commit and version, pass updater discovery, integrity, cancellation, retry, and installation-handoff tests, and pass Linux server admission and rollback tests. A failed platform blocks publication of the entire release.
3. **Publish:** let the workflow publish the complete installer and server set with `SHA256SUMS.txt` and `desktop-update.json`. Verify the source and workflow link in the Release notes, download accessibility, checksum agreement, and the latest stable version. Never overwrite a published tag or upload a partial platform set as a stable release. Public desktop metadata avoids unauthenticated GitHub API polling limits.
4. **Check installed clients:** record old-to-new upgrades for Windows x64, both macOS architectures, and Linux x64 AppImage. Check discovery, progress, cancellation, retry, task-interruption confirmation, restart, retained settings and conversations, and the reported new version. Keep source-development runs outside automatic replacement. Automated handoff tests and a real installed upgrade are separate evidence; incomplete platform acceptance remains pending. The first checker installation may require a manual installer.
5. **Deploy online:** use the same published stable server archive through the supervised updater, not an unreviewed source snapshot. Confirm idle admission, a retained application-data backup, maintenance handling, and readiness at the expected version before reporting deployment complete. If work is active, defer. If preparation, startup, or health checks fail, keep the failed version held and confirm restoration of the previous runtime and saved home before reopening service.
6. **Close out:** record the actual release and server versions, platform acceptance, check results, and any unresolved installation or signing limits. Monitor updater status and service logs after deployment. Do not remove a held-version or maintenance marker, discard a recovery backup, disable operating-system security, or force a redeployment to conceal a failed upgrade.

The workflow enforces packaging, updater regressions, complete assets, and immutable publication. The Linux updater enforces idle admission, checksum verification, backups, startup health, and rollback. The release owner verifies real installed upgrades and deployment results for each release; successful CI alone does not establish that the online service or every installed client has updated.

<a id="dev-note"></a>
## Dev Note

None.
