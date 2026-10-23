# 计算机操作

[English](computer-use.md) | 中文

计算机操作让模型通过配置的提供方观察并操作本地桌面。DSH 的共享能力称为 **computer use（计算机操作）**；**Cua Driver** 是上游实现的名称。

## 选择提供方

在同一组合中挂载 [`dsh-computer-use`](../../packages/computer-use/computer-use/README.zh.md) 和一个提供方。这些公开发布到 npm 的实验性包均需显式启用。

| 提供方 | 运行时 |
|---|---|
| [Cua Driver MCP](../../packages/experimental/computer-use-cua-driver-mcp/README.zh.md) | 通过 MCP 连接已安装的 `cua-driver` 可执行文件 |
| [Cua Driver 原生](../../packages/experimental/computer-use-cua-driver-native/README.zh.md) | 随 npm 依赖安装的平台原生运行时 |
| [统一控制](../../packages/experimental/computer-use-unified/README.zh.md) | 通过统一工具操作会话独立的 Playwright 标签页和原生 macOS 窗口；另需 `dsh-browser-use` |

Cua Driver 提供方提供上游工具目录；统一控制提供一个感知会话的工具。共享服务只注册名称，并拒绝任何第二个提供方，包括使用相同名称的另一个实例。服务不包含通用桌面操作方法或模型控制的选择器。

## 生命周期和桌面共享

提供方在关闭工具和自有资源期间保留注册。启动失败会释放此次尝试的注册。MCP 提供方在重连期间保留注册。

一个已注册的提供方不会为某个 Session 预留桌面。调用方负责协调跨 Session 和独立 DSH 进程的完整观察、操作和验证流程。取消调用无法撤销桌面已收到的输入。

## 结果和平台要求

工具使用常规执行流程和 Session 日志。支持图像的模型路由在挂载附件存储时接收持久化截图；不支持图像的路由接收现有 MCP 图像诊断。提供方 README 负责说明安装、权限和平台限制。

统一控制在 Windows 和 Linux 上报告仅浏览器能力，在首次访问桌面时初始化 macOS 原生驱动。可选输入审批设置使用已有的一次性审批服务。浏览器输入要求使用最近观察的元素；坐标输入有独立的截图有效期。[提供方参考](../../packages/experimental/computer-use-unified/README.zh.md)维护这些设置和失败语义。

可选[电脑控制组合包](../../packages/experimental/computer-control/README.zh.md)展示所选会话的当前目标。[`ComputerPreviewFrame`](../../packages/experimental/computer-use-unified/src/types.ts)区分 `idle`、`unavailable` 和 `frame`；图像携带原始 Unix 毫秒截图时间和当前操作状态。`ComputerPreviewSnapshot` 将结果与宿主指定的刷新间隔组合。`ComputerPreviewCursor` 使用相对窗口的比例坐标。显示端为每个活动会话注册一个 `ComputerPreviewCapture`，撤回时取消并等待已接受的截图。仅显示的预览保留操作观察，不增加模型输入或会话事件。

[决策记录](../../.agents/notes/implemented/architecture/2026-09-12-computer-use-provider-registration.zh.md)解释只负责注册的服务和两个 Cua Driver 集成。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputerpreview--computerpreviewcontroller"></a>

### `ctx.computerPreview` — `ComputerPreviewController`

Read-only Remote for images from the currently selected Session's target.

```ts cordis-catalog
/**
 * Capture only the existing target; never send mouse or keyboard input.
 * @param sessionId - displayed Session identity.
 * @param signal - browser cancellation or Remote withdrawal.
 * @returns a bounded preview and the Host-owned refresh interval.
 */
@Remote async frame(sessionId: SessionId, signal: AbortSignal): Promise<ComputerPreviewSnapshot>
```

Types: [SessionId](core.zh.md)

Source: [`packages/experimental/computer-control/src/preview.ts`](../../packages/experimental/computer-control/src/preview.ts)

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns one optional provider registration in the shared computer-use service.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name. Providers
 * must stop their tools and await owned work before releasing this registration.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
