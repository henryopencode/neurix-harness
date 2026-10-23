---
description: "Generate and save conversation images with OpenAI-compatible or MiniMax APIs."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image-generation

English | [中文](README.zh.md)

## Summary

Generate images from a detailed text prompt using an OpenAI-compatible Images API or MiniMax. Configure the provider, complete endpoint, image model, and API key, then ask for images in the conversation. Successful results are saved as durable attachments and display immediately in the GUI. Provider requests may incur charges, and the tool does not retry them automatically.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>

## Use this package

The shipped Web and Desktop profiles already provide tools and attachment storage. Enable the [optional bundle](../image-generation-bundle/README.md) through Plugins, or add the tool row to a custom composition.

### Minimal configuration

Keep a private configuration outside the repository and replace the key and model placeholders below. The model must be an image-generation model, separate from your conversation model.

```yaml
- name: '@deepseek-ai/dsh-tool-image-generation'
  config:
    enabled: true
    endpoint: https://api.openai.com/v1/images/generations
    apiKey: YOUR_IMAGE_API_KEY
    model: YOUR_IMAGE_MODEL
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Expose the tool after configuring a model and key |
| `provider` | `openai` | Wire protocol: `openai` or `minimax` |
| `endpoint` | OpenAI `/v1/images/generations` URL | Complete HTTP(S) generation endpoint |
| `apiKey` | required when enabled | Bearer API key; the configuration field is secret |
| `model` | required when enabled | Image model or deployment id accepted by the provider |
| `timeoutMs` | `180000` | Cooperative deadline including downloads and storage |
| `maxImages` | `4` | Per-call image count, also capped by attachment policy |
| `maxErrorsPerTurn` | `3` | Failed image calls allowed in one agent turn before stopping it |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-image-generation) lists every field. A configured `size` supplies the default size or ratio. A per-call `size` takes precedence; the tool instructs the model to supply it only when the user explicitly requests a size or ratio. Without a per-call value, generation uses the configured default or lets the provider choose when no default is set. `quality` sets an optional provider default and accepts per-call overrides. Leave `responseFormat` unset for GPT Image models; configure `url` or `b64_json` only when your compatible provider requires it. `outputFormat` is optional and must be supported by the provider. Copy the [CLI patch template](../../../apps/cli/config/examples/image-generation.patch.yml) outside the repository before adding your credentials.

For MiniMax, set `provider: minimax`, endpoint `https://api.minimax.cn/v1/image_generation`, and model `image-01`. MiniMax accepts supported ratios such as `16:9` or pixel dimensions from 512 to 2048, divisible by 8; leave `quality` and `outputFormat` unset. Prompts are limited to 1500 characters and requests to 9 images, also capped by deployment and attachment limits. `responseFormat: b64_json` maps to MiniMax's `base64`; URL responses remain the provider default. The adapter checks `base_resp.status_code` before accepting native image arrays; HTTP 200 alone does not imply success.

### Results and recovery

The tool accepts `prompt` and optional `count` and `size`; OpenAI-compatible mode also offers `quality`. MiniMax's tool schema describes its size and prompt limits and omits unsupported quality controls. It sends one generation request and accepts base64 image data or downloadable image URLs. PNG, JPEG, WebP, and GIF are supported when the attachment policy permits them. Images are validated and saved before a successful result; the result reports the actual count, dimensions, and local paths when storage exposes them.

The GUI shows an authorized attachment preview rather than using the provider URL. Saved results survive conversation reloads. Text-only conversation models receive the existing image-handle text projection; image-capable models can receive image content.

Failures distinguish configuration, request, provider, response, byte-limit, and storage errors. A provider or storage failure can follow a completed paid generation: check provider history before retrying. Raw response bodies and credentials do not appear in tool result text.

In a conversation, the third failed image call stops the current turn, preserves the last error and any queued user input, and prevents further provider requests in that turn. Changed arguments and successful calls do not reset the failure count; each agent and new turn gets its own allowance. Calls execute one at a time, so later calls in a batch are cancelled before dispatch when the cap is reached. Set `maxErrorsPerTurn` to a positive integer to change the cap. Standalone tool executions have no agent turn to stop.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The plugin registers the tool while `enabled` is true and replaces its registration on live configuration updates. Enabling without a model or key fails before persistence. Each invocation captures its configuration before HTTP acquisition; acquisition bounds JSON and image bytes, identifies media types, and saves the complete batch through `ctx.attachments`. The existing tool runtime logs text and durable image blocks. Host presenters remain pure, while the Client derives previews from those logged blocks.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Configuration, tool registration, and saved-result rendering |
| [`src/provider.ts`](src/provider.ts) | Images API request and image acquisition |
| [`src/http.ts`](src/http.ts) | Cancellable, bounded HTTP without redirects |
| [`src/minimax.ts`](src/minimax.ts) | MiniMax native options and response status |
</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Image-generation bundle](../image-generation-bundle/README.md) — GUI configuration entry.
- [Attachment storage](../../attachment/attachment-local/README.md) — validation, limits, and local persistence.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-image-generation) — the exact generated tool schema.

-----

<a id="model-experience"></a>

## Model Experience

### Tool schema

#### What the model sees

The [`generate_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-image-generation) requires a text prompt and offers optional count and size. Quality is available only in OpenAI-compatible mode. Provider credentials and deployment settings are absent from tool arguments.

#### Token effect

The schema adds a fixed request cost while the tool is visible.

#### KV Cache effect

The schema stays prefix-stable until configuration or tool visibility changes.

### Tool-call history and result

#### What the model sees

History retains the prompt, actual image count, dimensions, available local paths with ready-to-copy Markdown image references, and durable image blocks. The model must preserve the returned image destinations when embedding images in its final response. Text-only routes project image blocks into handle text; vision routes resolve them through attachment storage.

#### Token effect

Text cost grows with prompts and batch size. Image-capable routes also account for image input according to their provider pricing.

#### KV Cache effect

Calls and results append after the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- OpenAI mode requires `images/generations` requests and `data[].b64_json` or `data[].url` responses; MiniMax mode uses its native `image_generation` endpoint. Editing, streaming, style, and seed controls are not exposed.
- URL responses must be directly downloadable without authorization headers or redirects. The generation API key is sent only to the configured endpoint.
- Large provider outputs may exceed configured response or attachment limits; attachment normalization can resize accepted images. Paid requests are not retried automatically.

-----

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
