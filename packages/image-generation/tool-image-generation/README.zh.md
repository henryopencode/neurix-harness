---
description: "使用 OpenAI 兼容或 MiniMax 接口生成并保存对话图片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image-generation

[English](README.md) | 中文

## 概述

使用 OpenAI 兼容 Images API 或 MiniMax，根据详细文字描述生成图片。配置服务类型、完整接口地址、图片模型和 API Key 后，即可在对话中请求生图。成功结果保存为持久附件，并立即在 GUI 中显示。服务请求可能产生费用，工具不会自动重试。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

默认 Web 和 Desktop 配置方案已提供工具注册和附件存储。可以通过插件管理启用[可选组合](../image-generation-bundle/README.zh.md)，或在自定义组合中加入工具行。

### 最小配置

将私有配置保存在仓库外，并替换下面的密钥和模型占位值。这里的模型必须是图片生成模型，与对话模型独立。

```yaml
- name: '@deepseek-ai/dsh-tool-image-generation'
  config:
    enabled: true
    endpoint: https://api.openai.com/v1/images/generations
    apiKey: YOUR_IMAGE_API_KEY
    model: YOUR_IMAGE_MODEL
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 配置模型和密钥后开放工具 |
| `provider` | `openai` | 接口协议：`openai` 或 `minimax` |
| `endpoint` | OpenAI `/v1/images/generations` 地址 | 完整的 HTTP(S) 生图接口地址 |
| `apiKey` | 开启时必填 | Bearer API Key，配置字段按密钥处理 |
| `model` | 开启时必填 | 服务商接受的图片模型或部署 ID |
| `timeoutMs` | `180000` | 包含下载和保存的协作式调用截止时间 |
| `maxImages` | `4` | 单次调用的图片数量上限，同时受附件策略约束 |
| `maxErrorsPerTurn` | `3` | 每轮对话允许的生图失败次数，达到上限即停止本轮 |

[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-image-generation)列出全部字段。配置的 `size` 提供默认尺寸或比例，单次调用的 `size` 优先；工具说明要求模型只在用户明确指定尺寸或比例时传入该参数。单次调用未指定时使用配置默认值，默认值也未设置时交给服务选择。`quality` 设置可选的服务默认值，单次调用可以覆盖。GPT Image 模型应省略 `responseFormat`；仅在兼容服务要求时配置 `url` 或 `b64_json`。`outputFormat` 可选，必须由服务商支持。填写凭据前，先将[CLI 补丁模板](../../../apps/cli/config/examples/image-generation.patch.yml)复制到仓库外。

MiniMax 应设置 `provider: minimax`、接口地址 `https://api.minimax.cn/v1/image_generation` 和模型 `image-01`。MiniMax 接受 `16:9` 等支持的宽高比，或 512 到 2048 且为 8 的倍数的像素尺寸；`quality` 和 `outputFormat` 应留空。提示词最多 1500 字符，每次最多 9 张图片，同时受部署与附件限制约束。`responseFormat: b64_json` 会映射为 MiniMax 的 `base64`，默认仍由服务返回 URL。适配器会检查 `base_resp.status_code` 后再接收原生图片数组；HTTP 200 并不单独代表成功。

### 结果与恢复

工具接收 `prompt` 和可选的 `count`、`size`；OpenAI 兼容模式还提供 `quality`。MiniMax 的工具模式说明尺寸和提示词限制，并省略不支持的质量选项。它发送一次生成请求，接收 Base64 图片数据或可下载的图片 URL。附件策略允许时，可使用 PNG、JPEG、WebP 和 GIF。工具在成功返回前验证并保存图片，结果报告实际数量、尺寸，以及存储可提供的本地路径。

GUI 通过经过授权的附件预览显示图片，不直接使用服务商 URL。保存的结果在重新打开对话后仍可访问。普通文本对话模型接收现有的图片引用文本投影，支持视觉输入的模型可以接收图片内容。

失败会区分配置、参数、服务、响应、字节上限和存储错误。服务或存储失败可能发生在已完成收费生成之后，应先检查服务记录再重试。工具结果文本不会包含原始响应正文或密钥。

对话中第三次生图失败会停止当前轮次，保留最后的错误和已排队的用户输入，并阻止本轮后续的服务请求。修改参数或成功调用不会重置失败计数；不同 Agent 和新的轮次各有独立额度。调用逐个执行，因此批量调用达到上限时，后续调用会在发送前取消。可以将 `maxErrorsPerTurn` 设为正整数来调整上限。独立工具执行没有可停止的 Agent 轮次。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

插件在 `enabled` 为 true 时注册工具，实时配置更新会替换该注册。缺少模型或密钥时，开启操作会在保存前失败。每次调用在 HTTP 访问前读取当时的配置，数据获取限制 JSON 和图片字节数、识别媒体类型，并通过 `ctx.attachments` 保存整个批次。现有工具运行时记录文本和持久图片块。Host 展示器保持纯函数，Client 从已记录的图片块派生预览。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 配置、工具注册与已保存结果的渲染 |
| [`src/provider.ts`](src/provider.ts) | Images API 请求与图片获取 |
| [`src/http.ts`](src/http.ts) | 可取消、限制字节数且拒绝重定向的 HTTP |
| [`src/minimax.ts`](src/minimax.ts) | MiniMax 原生参数与响应状态 |
</details>

-----

<a id="further-exploration"></a>

## 进一步探索

- [图片生成组合](../image-generation-bundle/README.zh.md) — GUI 配置入口。
- [附件存储](../../attachment/attachment-local/README.zh.md) — 校验、上限与本地持久保存。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-image-generation) — 完整的生成工具定义。

-----

<a id="model-experience"></a>

## 模型体验

### 工具定义

#### 模型看到的内容

[`generate_image` 定义](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-image-generation)要求文字提示词，并提供可选的数量和尺寸参数。质量参数仅在 OpenAI 兼容模式中提供。工具参数不包含服务密钥和部署配置。

#### Token 影响

工具可见时，工具定义产生固定的请求开销。

#### KV Cache 影响

工具定义的前缀保持稳定，直到配置或工具可见性变化。

### 工具调用历史与结果

#### 模型看到的内容

历史保留提示词、实际图片数量、尺寸、带有可直接复制的 Markdown 图片引用的可用本地路径，以及持久图片块。模型在最终回复中嵌入图片时必须保留返回的图片地址。文本路由将图片块投影为引用文本，视觉路由通过附件存储读取图片。

#### Token 影响

文本开销随提示词和批次数量增长。支持图片输入的路由还按服务商计价方式计算图片输入开销。

#### KV Cache 影响

调用与结果追加在可复用的请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- OpenAI 模式要求 `images/generations` 请求和 `data[].b64_json` 或 `data[].url` 响应；MiniMax 模式使用原生 `image_generation` 接口。工具暂不提供图片编辑、流式输出、画风与随机种子设置。
- URL 响应必须支持直接下载，不能依赖授权请求头或重定向。生成接口的 API Key 仅发送到已配置的接口地址。
- 较大的服务输出可能超过响应或附件上限，附件规范化可能缩小已接收图片。收费请求不会自动重试。

-----

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者说明 — 点击展开</summary>

无。

</details>
