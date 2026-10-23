# Neurix Harness

[English](README.md) | 中文

Neurix Harness（`dsh`）是基于[上游项目](https://github.com/deepseek-ai/deepseek-harness)的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[用户指南](docs/user/guide/index.zh.md) · [架构](docs/architecture.zh.md)

## 开发者预览

Neurix Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/henryopencode/neurix-harness.git
cd neurix-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

已有安装请按[升级指南](docs/upgrade-guide/v0.2.1-alpha.2/neurix-rc3/guide.zh.md)检查 Node.js、模型和 Session 兼容性。

## 社区与支持

- 通过 [GitHub Issues](https://github.com/henryopencode/neurix-harness/issues) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{neurix-harness2026,
  title={Neurix Harness: Everything is a Plugin},
  author={Neurix Contributors},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/henryopencode/neurix-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
