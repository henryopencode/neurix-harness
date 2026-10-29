# 桌面版发布

[English](releasing.md) | 中文

## 概述

在 `develop` 开发，通过拉取请求将稳定改动合并到 `master`。合并会预留版本号，构建 Windows x64、macOS arm64、macOS x64 和 Linux x64 安装包，并发布一个完整的 GitHub Release。日常开发上传只运行检查，不生成安装包。

## 目录

- [开发与发布](#development-and-release)
- [版本与重试](#versions-and-retries)
- [已安装应用的更新检查](#installed-update-checks)
- [开发备注](#dev-note)

<a id="development-and-release"></a>
## 开发与发布

`develop` 是默认开发分支。**Neurix development checks** 工作流检查向该分支的推送，以及向这两个分支的拉取请求，运行构建、lint 和单元测试。本仓库已停用依赖上游专用设施的自动工作流，其文件保留供参考。

改动准备好后，从本仓库的 `develop` 向 `master` 创建拉取请求。**Neurix stable desktop release** 仅在该请求合并后运行。直接关闭请求、合并其他分支以及直接推送均不发布安装包。四个平台任务必须全部成功后才会出现 Release。每个安装包都包含应用及匹配的运行时。GitHub Releases 还提供安装包和 Linux Web 服务器归档的 `SHA256SUMS.txt`。

安装包不使用发布签名凭据：Windows 未签名，macOS 使用未经公证的 ad-hoc 签名，Linux 使用 AppImage，均不连接上游自动更新服务。可靠的 macOS 无人值守替换需要 Developer ID 签名与公证。

<a id="versions-and-retries"></a>
## 版本与重试

首次发布为 `1.0.0`，后续稳定版本递增补丁号。主动提高稳定的清单版本，或使用工作流中的显式版本输入，可发布次版本或主版本。自动化在 `master` 的一个版本提交中对齐 dsh 工作区清单和锁文件，再与 `v<版本>` 和 `dsh-v<版本>` 标签一起原子推送。Vendored 和 native 包保留独立版本序列。

版本预留基于最新的 `master`，不会覆盖并发合并。版本提交记录触发它的合并；重试同一次工作流会复用不可变标签。某个平台失败时，在下一次稳定合并前修复问题；基础设施临时失败则重跑失败任务。已预留版本不用于不同源码，已发布 Release 不被覆盖。

试打包时，手动运行发布工作流并开启 **validation_only**。可选择一个平台或全部平台；它构建所选分支并上传 Actions 产物，不写入版本、标签或 Release。手动发布必须选择 `master` 并关闭 **validation_only**。本地查看版本选择且不改文件，可运行：

```sh
pnpm exec tsx scripts/release/desktop-stable.ts --plan
```

<a id="installed-update-checks"></a>
## 已安装应用的更新检查

先安装一次包含更新检查功能的安装包。应用会在启动时、定期以及通过现有更新菜单检查本仓库最新稳定 GitHub Release，排除草稿和预发布版本。有新版本时，现有更新指示器会提示；点击**下载更新**，浏览器会下载与应用系统及架构匹配的安装包。打开下载的安装包即可更新，配置和会话保留。

此下载流程保持当前应用运行，不申请安装权限，也不保存 GitHub token。主动检查失败时显示现有重试操作。首次 Release 发布前不提供更新；尚不包含检查功能的旧版需要先手动更新一次。

<a id="dev-note"></a>
## 开发备注

无。
