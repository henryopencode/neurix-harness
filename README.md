# Neurix Harness

English | [中文](README.zh.md)

Neurix Harness (`dsh`) is an open-source agent harness based on the [upstream project](https://github.com/deepseek-ai/deepseek-harness).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [User guide](docs/user/guide/index.md) · [Architecture](docs/architecture.md)

## Developer preview

Neurix Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/henryopencode/neurix-harness.git
cd neurix-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Issues](https://github.com/henryopencode/neurix-harness/issues).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{neurix-harness2026,
  title={Neurix Harness: Everything is a Plugin},
  author={Neurix Contributors},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/henryopencode/neurix-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
