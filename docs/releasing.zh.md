# 桌面版发布

[English](releasing.md) | 中文

## 概述

在 `develop` 开发，把准备好的改动合并到 `master`。通过稳定版工作流或自己的构建机器，为 Windows x64、macOS arm64、macOS x64 和 Linux x64 发布一份完整的 GitHub Release。开发检查不生成安装包。

## 目录

- [开发与发布](#development-and-release)
- [版本与重试](#versions-and-retries)
- [在自己的机器上发布](#local-release)
- [已安装应用的更新检查](#installed-update-checks)
- [服务器更新](#server-updates)
- [正式发布与线上部署 SOP](#production-release-sop)
- [开发备注](#dev-note)

<a id="development-and-release"></a>
## 开发与发布

`master` 是仓库的默认分支，日常开发保留在 `develop`。**Neurix development checks** 工作流检查向 `develop` 的推送，以及向这两个分支的拉取请求，运行构建、lint，以及改动源码、其静态依赖方和受影响插件所属的单元测试，不运行全量单元测试。本仓库已停用依赖上游专用设施的自动工作流，其文件保留供参考。

启用后，**Neurix stable desktop release** 监听 master 推送，包括普通合并、压缩合并和直接推送。开发分支推送以及未合并就关闭拉取请求均不发布安装包。四个平台必须全部通过才会发布 Release。产物核对前保留在草稿中，GitHub 的版本排序确保较旧构建不会替换最新 Release。每个安装包都包含应用及匹配的运行时。`SHA256SUMS.txt` 覆盖安装包和 Linux Web 服务器归档。

安装包不使用发布签名凭据：Windows 未签名，macOS 使用未经公证的 ad-hoc 签名，Linux 使用 AppImage，均不连接上游自动更新服务。操作系统安全策略仍可能阻止未签名的安装包；签名和公证仍是正式发行质量要求。

<a id="versions-and-retries"></a>
## 版本与重试

首次发布为 `1.0.0`，后续稳定版本递增补丁号。主动提高稳定的清单版本或显式指定版本，可发布次版本或主版本。两种发布方式都在 `master` 的一个版本提交中对齐 dsh 工作区清单和锁文件，再与 `v<版本>` 和 `dsh-v<版本>` 标签一起原子推送。Vendored 和 native 包保留独立版本序列。

`package.json` 通过 `dshApiVersion` 声明官方插件 API 基线，与 Neurix 发行版本独立。同步上游时，需要对齐各 DSH 工作区清单中的该值；工作区约束会拒绝缺失或不一致的声明。[插件版本要求检查](../packages/boot/app-boot/README.zh.md#profiles)使用此基线，并保留精确的 Neurix 发行版本约束。

版本预留基于最新的 `master`，不会覆盖并发合并。版本提交记录触发它的合并；重试同一次工作流会复用不可变标签。某个平台失败时，在下一次稳定合并前修复问题；基础设施临时失败则重跑失败任务。已预留版本不用于不同源码，已发布 Release 不被覆盖。

通过工作流试打包时，开启 **validation_only**。可选择一个或全部平台；工作流构建所选分支并上传 Actions 产物，不写入版本、标签或 Release。手动触发工作流发布时，选择 `master` 并关闭 **validation_only**。本地查看版本选择且不改文件，可运行：

```sh
pnpm exec tsx scripts/release/desktop-stable.ts --plan
```

工作流或测试夹具修复后，重新构建已有预留版本时，将 **existing_tag** 设为对应的 `v<version>` 标签，并将 **version** 留空。成对标签、清单版本、预留元数据与 master 历史必须一致。安装包仍使用原标签提交；更新的预留测试仅在打包后复制。Release 说明同时记录打包源码与验证工作流提交。仅修复发布验证的 PR 通过检查后，在合并提交标题中加入 `[skip ci]`，避免预留另一个版本，再从 `master` 手动重试：

```sh
gh workflow run neurix-desktop-release.yml --ref master -f existing_tag=v1.1.0 -f validation_only=false
```

<a id="local-release"></a>
## 在自己的机器上发布

`pnpm release:desktop --help` 列出本地命令。计划本地发布时，请在合并前暂停[稳定版发布工作流](https://github.com/henryopencode/neurix-harness/actions/workflows/neurix-desktop-release.yml)，确保同一版本只有一个发布方，并保留开发检查。使用干净的检出与 Node.js 24.9 或更高版本；预留版本需要 Git 推送权限，上传草稿和发布需要已登录且有写权限的 GitHub CLI。Windows 和 Linux 使用各自的 x64 构建机器，两种 macOS 目标使用兼容的 Mac。构建工具见 [Desktop 打包](../apps/desktop/packaging/README.zh.md)；Linux 还需要 Python 3 和稳定版工作流列出的 Linux 打包工具。

1. 合并后获取 `origin/master` 及其标签，以 detached HEAD 检出 `origin/master`，用 `pnpm install --frozen-lockfile` 安装依赖，再运行 `pnpm release:desktop reserve`。命令检查产品依赖隔离，并一起推送版本提交和两个标签。可用 `--version` 选择更高的稳定版本。如果源码已有预留版本，使用对应标签。
2. 在各构建机器上获取并检出预留标签，再按锁文件安装依赖。用上一步的标签替换 `v1.2.3`，并选择 `win-x64`、`mac-arm64`、`mac-x64` 或 `linux-x64`。每个目标在完成打包并通过更新器测试后写出一个目录；Linux 还会构建服务器归档并执行服务器更新测试。

```sh
pnpm release:desktop build --tag v1.2.3 --target mac-arm64 --assets ../desktop-assets
```

3. 将四个目标目录连同各自的 `build.json` 汇总到一个产物目录。在干净的检出里运行 `draft` 并核对 GitHub Release 草稿。命令核对构建提交和校验值，生成 `SHA256SUMS.txt` 和 `desktop-update.json`，并直接上传到 Releases。单独执行 `publish` 时，命令重新核对 GitHub 上的七个文件，仅发布匹配的草稿。

```sh
pnpm release:desktop draft --tag v1.2.3 --assets ../desktop-assets
pnpm release:desktop publish --tag v1.2.3 --assets ../desktop-assets
```

如果 Git 或 GitHub 未确认写入，先检查远端标签或 Release，再沿用相同输入重试。匹配的草稿可继续上传缺失文件。命令不会替换冲突文件或已经发布的文件。按[正式发布 SOP](#production-release-sop)验证公开下载和已安装版本的升级。

<a id="installed-update-checks"></a>
## 已安装应用的更新检查

先安装一次包含此更新检查器的安装包。它会在启动时、每十分钟附加有限随机延迟、到达下次检查时间后恢复前台或从休眠恢复时，以及通过更新菜单检查本仓库最新的稳定 GitHub Release，排除草稿和预发布版本。左下角更新入口下载对应操作系统和架构的安装包，并提供进度和取消操作。文件大小及 SHA-256 校验通过后才提供“安装并重启”。设置和会话继续保存在现有目录。

安装会单独确认是否中断活动任务，并完成 Host 关闭。Windows 启动按用户安装的 NSIS 安装器并请求重新启动。macOS 在现有应用旁暂存并验证 DMG 中的应用；Linux 在正在使用的 AppImage 旁暂存可执行的新 AppImage。独立工作进程等待应用进程退出后替换文件并请求重新启动；替换或启动交接失败时恢复旧应用。新版本完成 Host 启动后才移除备份；新运行时无响应仍需要维护者处理；应用备份不恢复已经迁移的用户数据。安装目录必须可写。网络失败保留明确的重试入口；下载失败不会自动重试。首次发布稳定 Release 前不提示更新。没有此检查器的旧安装需要先手动更新一次；源码开发进程不会被替换。

<a id="server-updates"></a>
## 服务器更新

Linux 部署使用 [`scripts/deploy`](../scripts/deploy/server-update.py) 中的独立 systemd 更新器，定时器每十分钟检查本仓库最新已发布的稳定 Release。更新器通过 `SHA256SUMS.txt` 校验服务器运行包，拒绝草稿、预发布版本和缺少产物的 Release。开发构建仍由明确指定的快照安装。

私有更新控制插件通过权限为 0600 的 Unix socket 报告活动 Agent、排队输入和后台任务。更新会等待任务空闲，锁住新的 API 请求，并等待已接受的请求结束；安装时临时返回维护状态，停止服务并备份 Harness home，然后切换程序目录。新版报告版本与就绪状态后，客户端才能重新连接。启动失败会恢复旧程序和备份的数据目录；失败版本会暂停重试，等待管理员检查。工作区文件保留在原目录。

服务、定时器、控制补丁和部署路径配置均与更新器放在一起。安装后，运行 `python3 /etc/neurix-agent/server-update.py` 可仅检查而不安装；运行 `systemctl start neurix-agent-update.service` 可请求下次空闲更新。结果记录在 `/opt/neurix-agent/update-status.json` 及更新服务日志中。解包会保留归档权限，不受更新器的严格 umask 影响，并保证隐式创建的 runtime 父目录可遍历；下载的代码不会以 root 执行。管理员查明失败版本的原因并验证修复后，可通过 `--archive`、`--version` 和 `--sha256` 重试已校验的归档，同时保留失败记录和备份。只有安装成功才会解除该版本的暂停状态。

<a id="production-release-sop"></a>
## 正式发布与线上部署 SOP

每次正式发布和线上部署均执行以下顺序。记录源码提交、版本、工作流链接或本地验证结果、校验值、平台结果、线上版本及恢复结果。缺少证据的项目保留为待验证；试打包不代表正式发布，下载不代表安装完成。

1. **准备：** 使用干净的发布检出，检查完整改动，并按[推送前检查](../.agents/skills/dsh-pre-push-checks/SKILL.md)选择验证。用于验证的源码检出中不得混入本地构建或部署快照。相关失败必须在合并前修复；无法完成的签名或平台验证明确记录。
2. **构建：** 合并到 `master` 后使用稳定版工作流或[本地命令](#local-release)。全部平台必须构建同一预留提交与版本，并通过更新发现、完整性、取消、重试及安装交接测试。Linux 还必须通过服务器准入与回退测试。任一平台失败均阻止发布。
3. **发布：** 核对完整的安装包和服务器产物，以及 `SHA256SUMS.txt` 和 `desktop-update.json`，再发布草稿。确认 Release 说明列出源码和验证依据、公开下载可达、校验值一致、最新稳定版本正确。不得覆盖已发布标签或发布缺少平台的稳定版。桌面端使用公开元数据，避免轮询耗尽 GitHub API 匿名配额。
4. **客户端验收：** 分别记录 Windows x64、两种 macOS 架构及 Linux x64 AppImage 从旧版升级到新版的结果。检查发现更新、进度、取消、重试、任务中断确认、重启、配置与会话保留，以及启动后版本。源码开发进程不参与自动替换。自动化交接测试与真实已安装升级分别记录；未完成的平台验收保留为待验证。首次安装更新检查器可能需要手动运行安装包。
5. **线上部署：** 通过受监督更新器部署同一正式 Release 的服务器归档，不使用未审查的源码快照。确认空闲准入、应用数据备份、维护状态，以及目标版本的就绪结果后，才可报告上线完成。存在活动任务时延期；准备、启动或健康检查失败时保留失败版本阻止状态，确认旧运行时及保存的 home 恢复后再开放服务。
6. **收尾：** 记录实际发行与线上版本、平台验收、检查结果，以及未解决的安装或签名限制。部署后检查更新状态与服务日志。不得通过清除失败版本或维护标记、丢弃恢复备份、关闭操作系统安全策略或强制重部署来掩盖升级失败。

两种发布方式都强制检查打包、更新回归、完整产物与不可覆盖发布。Linux 更新器强制执行空闲准入、校验、备份、启动健康检查与回退。每次发布的已安装版本升级及线上结果由发布负责人核实。

<a id="dev-note"></a>
## 开发备注

无。
