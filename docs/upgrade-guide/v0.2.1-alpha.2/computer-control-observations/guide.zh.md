---
kind: upgrade-guide
description: "电脑控制要求浏览器元素来自最近观察，并对坐标输入设置独立的截图有效期。"
---

# 电脑控制要求使用当前已观察的元素

[English](guide.md) | 中文

## 变更

浏览器定位器必须唯一命中最近 `fields` 或 `geometry.elements` 包含的实际 DOM 节点。节点被替换、发生导航或省略地址时编辑器焦点改变，都需要重新观察。坐标输入除受 `observationMaxAgeMs` 限制外，还使用默认 30000 毫秒的 `coordinateMaxAgeMs`。Windows 和 Linux 只提供浏览器能力，在输入前拒绝原生应用操作。

原生桌面运行时在首次使用时初始化。启用插件不检查原生运行时是否可用；启动失败由受影响的桌面调用报告。

原生观察在完整 `maxSnapshotChars` 结果文本预算内返回精简控件，省略重复的 `tree_markdown`、驱动诊断与逐控件屏幕 `frame`。过期原生引用只有在完整观察中能唯一识别未变化的可见控件时续用；否则在投递输入前失败。

## 迁移

1. 复制返回的定位器；发生导航、元素替换、编辑器焦点变化，或收到 `ELEMENT_NOT_OBSERVED`、`SCREENSHOT_EXPIRED` 时重新观察。切换编辑器时使用显式定位器。
2. 仅在部署需要不同截图有效期时，在统一提供方的 YAML `config` 中设置 `coordinateMaxAgeMs`。坐标输入必须位于返回截图的尺寸范围内。
3. 检查 `computer` 结果中的 `capabilities.native`。为 `false` 时使用浏览器目标；原生桌面操作要求 macOS。
4. 对未出现在 `fields` 和 `geometry.elements` 中的控件，使用截图坐标和支持图像输入的模型，或由用户处理。
5. 发送输入前，使用 `list` 检查桌面权限与原生启动状态。桌面访问不可用时，仅浏览器流程使用无头模式或关闭原生反馈。
6. 通过原生 `state.elements` 与 `screenshot_frame` 读取控件和截图坐标。处理 `elements_complete: false` 与 `omitted_elements`；必需控件被省略或元数据超过预算时增大 `maxSnapshotChars`。收到 `OBSERVATION_CHANGED` 后重新观察。
