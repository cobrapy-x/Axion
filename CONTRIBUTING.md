# Contributing to Axion

Thanks for helping. Axion is licensed under Apache-2.0. By contributing you agree your contribution is licensed the same way (Apache-2.0, section 5).

## Quick start

```sh
npm install
npm run setup   # one-time: checks arduino-cli, installs the AVR and Pico cores
npm run dev     # http://127.0.0.1:5173
npm test        # engine + firmware tests, no browser needed
```

The desktop app (`src-tauri/`, Rust) needs [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/): `npm run desktop` runs it in
development mode, `npm run desktop:build` builds an installer, and
`cargo test --manifest-path src-tauri/Cargo.toml` runs its unit tests.

## Releases

Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`,
add a CHANGELOG entry, then push a tag (`git tag v0.5.0`, `git push origin v0.5.0`). The Release
workflow builds the installers for Windows, macOS and Linux and attaches them to a draft
release on GitHub; check it and press Publish.

## Adding a part

See [docs/WRITING_PARTS.md](docs/WRITING_PARTS.md). A new part is one folder with three files plus a test. Please keep parts small and self-contained.

## Rules of thumb

- **Lightweight first.** Avoid new runtime dependencies. If you need one, it must be MIT/BSD/ISC/Apache-2.0/Zlib and small.
- **No GPL code inside the app.** GPL tools may only be used as separate programs (like arduino-cli). LGPL code may appear only in prebuilt example firmware (Arduino cores).
- **Keep the engine DOM-free.** Anything in `src/core`, `src/mcu` and `src/parts/*/model.ts` must run in Node.
- **Stay Wokwi-compatible** where a Wokwi part already exists: same `type`, same pin names.
- Add an SPDX header to new files: `// SPDX-License-Identifier: Apache-2.0`.

## Before opening a pull request

```sh
npm run typecheck && npm test && npm run build
```
