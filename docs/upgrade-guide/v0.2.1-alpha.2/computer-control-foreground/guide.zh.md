---
kind: upgrade-guide
description: "电脑控制的后台模式仅支持浏览器标签页，桌面应用需要明确选择前台模式。"
---

# 电脑控制的后台模式仅支持网页

[English](guide.md) | 中文

## 变更

电脑控制默认设置为 `inputMode: background`，界面名称为**网页后台**。此模式不发现、启动、观察或输入桌面应用。桌面访问必须由用户明确选择**前台系统操作**。操作模式与输入审批的修改对已有对话的下一次操作生效；其他运行默认值保留首次使用时读取的设置。浏览器 JavaScript 弹窗仍使用后台反馈。

本插件将统一提供方的 `nativeBackground` 设置为 false。直接挂载统一提供方的配置默认保留实验性原生后台访问。原生像素点击与输入在派发前失败，因为 SDK 即使收到后台投递请求，也可能激活目标。后台投递回执不能证明窗口焦点保持不变。

## 迁移

1. 浏览器任务使用**网页后台**。桌面任务请在“插件 → 扩展工具 → 电脑控制”中选择**前台系统操作**并保存。此设置不会自动切换。
2. 切换模式后重新列出目标。`capabilities.native: false` 且 `nativeForeground: true` 表示前台模式可开放桌面操作。`NATIVE_FOREGROUND_REQUIRED` 表示尚未派发桌面操作；用户切换模式前应停止原生尝试。
3. CLI 示例补丁也设置 `nativeBackground: false`。桌面任务请在提供方的 `config` 下设置 `inputMode: foreground`。直接使用统一提供方的配置可通过 `nativeBackground: true` 保留实验性无障碍路径；原生像素点击与输入仍会在派发前报告 `BACKGROUND_PIXEL_UNAVAILABLE`。
4. 将 `inputMode` 视为请求的设置，分别核对预期界面结果和实际焦点。前台动作会占用桌面；**停止生成**取消后续输入，已投递的输入保留。
