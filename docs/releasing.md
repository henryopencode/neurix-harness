# Desktop releases

English | [中文](releasing.zh.md)

## Summary

Develop on `develop` and merge ready changes into `master`. Publish a complete GitHub Release for Windows x64, macOS arm64, macOS x64, and Linux x64 through the stable workflow or from your own build hosts. Development checks do not create installers.

## Table of Contents

- [Development and release](#development-and-release)
- [Versions and retries](#versions-and-retries)
- [Publish from your own machines](#local-release)
- [Installed update checks](#installed-update-checks)
- [Server updates](#server-updates)
- [Production release and deployment SOP](#production-release-sop)
- [Dev Note](#dev-note)

<a id="development-and-release"></a>
## Development and release

`master` is the repository's default branch; ongoing development stays on `develop`. The **Neurix development checks** workflow validates pushes to `develop` and pull requests to either branch. It runs the build, lint, and unit tests for changed source, its static consumers, and affected plugin owners; it does not run the full unit suite. The repository's upstream-specific automated workflows are disabled in this fork; their files remain available for reference.

When enabled, **Neurix stable desktop release** responds to master pushes, including ordinary merges, squash merges, and direct pushes. Development-branch pushes and closing a pull request without merging do not publish installers. All four platforms must pass before a Release appears. Drafts hold the assets until verification, and GitHub's version ordering keeps an older build from replacing the newest Release. Each installer includes the application and its matching runtime. `SHA256SUMS.txt` covers the installers and the Linux Web server archive.

The installers use no release-signing secrets: Windows is unsigned, macOS uses ad-hoc signing without notarization, and Linux uses AppImage. They do not connect to the upstream automatic-update service. Operating-system security policy can still block unsigned installers; signing and notarization remain release-quality requirements.

<a id="versions-and-retries"></a>
## Versions and retries

The first release is `1.0.0`; later stable releases increment the patch. A deliberately higher stable manifest version or an explicit version selects a minor or major release. Both release paths align the dsh workspace manifests and lockfile in one version commit on `master`, then atomically push it with `v<version>` and `dsh-v<version>` tags. Vendored and native package versions retain their independent sequences.

`package.json` declares the official plugin API baseline in `dshApiVersion`, independently of the Neurix release version. Keep that value aligned across DSH workspace manifests when synchronizing upstream; workspace constraints reject missing or mismatched declarations. [Plugin requirement checks](../packages/boot/app-boot/README.md#profiles) use this baseline and retain exact Neurix release pins.

Version reservation uses the latest `master` so a concurrent merge cannot be overwritten. The version commit records the triggering merge; retrying that workflow reuses its immutable tags. If a platform fails, fix the failure before another stable merge, or rerun the failed jobs for a transient infrastructure failure. A reserved version is not reused for different source. A published Release is not overwritten.

For a workflow rehearsal, turn on **validation_only**. Select one or all platforms; the workflow builds the selected branch and uploads Actions artifacts without writing versions, tags, or Releases. To publish through a workflow dispatch, select `master` and turn off **validation_only**. To inspect local version selection without changes, run:

```sh
pnpm exec tsx scripts/release/desktop-stable.ts --plan
```

To rebuild an existing reservation after workflow or test-fixture repairs, set **existing_tag** to its `v<version>` tag and leave **version** empty. The paired tags, manifest version, reservation metadata, and master ancestry must agree. Installers use the original tagged commit; updated reservation tests are copied only after packaging. Release notes identify both the packaged source and qualification workflow commit. A qualification-only repair merges after its PR checks pass, with `[skip ci]` in the merge subject to avoid reserving another version; then run the manual retry from `master`:

```sh
gh workflow run neurix-desktop-release.yml --ref master -f existing_tag=v1.1.0 -f validation_only=false
```

<a id="local-release"></a>
## Publish from your own machines

`pnpm release:desktop --help` lists the local commands. Pause the [stable release workflow](https://github.com/henryopencode/neurix-harness/actions/workflows/neurix-desktop-release.yml) before merging a version you intend to publish locally, so it has one publisher. Keep development checks enabled. Use clean checkouts, Node.js 24.9 or later, Git push access for reservation, and an authenticated GitHub CLI with write access for draft and publish. Build Windows and Linux on matching x64 hosts, and the two macOS targets on compatible Macs. See [Desktop packaging](../apps/desktop/packaging/README.md) for build tools; Linux also needs Python 3 and the Linux packaging tools listed in the stable release workflow.

1. After merging, fetch `origin/master` and its tags. Check out `origin/master` with detached HEAD and install dependencies with `pnpm install --frozen-lockfile`. Run `pnpm release:desktop reserve`. It runs the product isolation check and pushes the version commit and both tags together. Add `--version` to choose a higher stable version. If the source already has a reservation, use its tag.
2. On each build host, fetch and check out the reserved tag and install its locked dependencies. Use the tag from the previous step in place of `v1.2.3` and select one of `win-x64`, `mac-arm64`, `mac-x64`, or `linux-x64`. Each target writes one directory after packaging and passing the updater tests; Linux also builds and tests the server deliverable.

```sh
pnpm release:desktop build --tag v1.2.3 --target mac-arm64 --assets ../desktop-assets
```

3. Collect the four target directories, including their `build.json` files, under one assets directory. From a clean checkout, run `draft` and review the resulting GitHub Release. It verifies the build commits and checksums, generates `SHA256SUMS.txt` and `desktop-update.json`, and uploads directly to Releases. Run `publish` separately; it rechecks all seven GitHub assets and publishes only a matching draft.

```sh
pnpm release:desktop draft --tag v1.2.3 --assets ../desktop-assets
pnpm release:desktop publish --tag v1.2.3 --assets ../desktop-assets
```

If Git or GitHub does not confirm a write, inspect the remote tags or the Release before retrying with the same inputs. A matching draft can resume missing uploads. Conflicting and already published files are never replaced. Follow the [production SOP](#production-release-sop) to verify public downloads and installed upgrades.

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

Every stable release and online deployment follows this sequence. Record the source commit, version, workflow URL or local qualification results, checksums, platform results, deployed version, and recovery outcome. Keep missing evidence pending; a rehearsal is not a published release, and a download is not an installed upgrade.

1. **Prepare:** use a clean release checkout, inspect the complete change, and run the evidence selected by [pre-push checks](../.agents/skills/dsh-pre-push-checks/SKILL.md). Keep local build and deployment snapshots outside the source checkout used for validation. Fix relevant failures before merging; record unavailable signing or platform evidence explicitly.
2. **Build:** merge into `master` and use the stable workflow or the [local commands](#local-release). All platforms must build the same reserved commit and version and pass updater discovery, integrity, cancellation, retry, and installation-handoff tests. Linux must also pass server admission and rollback tests. A failed platform blocks publication.
3. **Publish:** verify the complete installer and server set with `SHA256SUMS.txt` and `desktop-update.json` before publishing the draft. Confirm the Release notes identify the source and qualification, public downloads are accessible, checksums agree, and the latest stable version is correct. Never overwrite a published tag or publish a partial stable release. The public desktop metadata avoids unauthenticated GitHub API polling limits.
4. **Check installed clients:** record old-to-new upgrades for Windows x64, both macOS architectures, and Linux x64 AppImage. Check discovery, progress, cancellation, retry, task-interruption confirmation, restart, retained settings and conversations, and the reported new version. Keep source-development runs outside automatic replacement. Automated handoff tests and a real installed upgrade are separate evidence; incomplete platform acceptance remains pending. The first checker installation may require a manual installer.
5. **Deploy online:** use the same published stable server archive through the supervised updater, not an unreviewed source snapshot. Confirm idle admission, a retained application-data backup, maintenance handling, and readiness at the expected version before reporting deployment complete. If work is active, defer. If preparation, startup, or health checks fail, keep the failed version held and confirm restoration of the previous runtime and saved home before reopening service.
6. **Close out:** record the actual release and server versions, platform acceptance, check results, and any unresolved installation or signing limits. Monitor updater status and service logs after deployment. Do not remove a held-version or maintenance marker, discard a recovery backup, disable operating-system security, or force a redeployment to conceal a failed upgrade.

Both release paths enforce packaging, updater regressions, complete assets, and immutable publication. The Linux updater enforces idle admission, checksum verification, backups, startup health, and rollback. The release owner verifies installed upgrades and deployment results for each release.

<a id="dev-note"></a>
## Dev Note

None.
