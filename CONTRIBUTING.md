# Contributing to duo180 Office

Thanks for your interest in contributing.

duo180 Office is a **fork of [GenOffice](https://github.com/genspark-ai/genoffice)**
(Apache-2.0) that works towards a simplified office suite: native `.docx`,
`.xlsx` and `.pptx` editing with byte-preserving round trips, and without the
AI layer of the original project. The original code and its license are kept;
see [LICENSE](LICENSE) and [NOTICE](NOTICE).

This repository is a normal GitHub repository: `main` is the development
branch, and pull requests are reviewed and merged here. There is no mirror,
no private tree and no CLA — by contributing you agree that your contribution
is licensed under Apache-2.0, inbound = outbound.

## Repository layout

- `apps/*` — the Electron apps (docs, sheets, slides, pdf, markdown, html,
  shell). Each app is an npm workspace with its own `src/main` (Electron main
  process), `src/renderer` (React UI) and `tests/`.
- `packages/*` — pure TypeScript engine and shared packages (no Electron
  dependency, unit-tested): docx/pptx engines, xlsx gateway, pdf2docx,
  html2docx, search-index text extraction, i18n, UI kit.
- `apps/sheets/native/xlsx-engine` — Rust xlsx engine (runs as a sidecar
  process) for xlsx import/export.

### Engine packages

All pure TypeScript, no Electron dependency, unit-tested (except the UI kit):

- `packages/docx-engine` — docx parsing → block tree (with `docxIndex`
  anchors and passthrough), OOXML fragment generation, byte-level paragraph
  patching.
- `packages/pptx-engine` / `packages/pptx-render` / `packages/pptx-ops` —
  pptx model, rendering and edit ops.
- `packages/xlsx-gateway` — TypeScript gateway to the Rust xlsx sidecar.
- `packages/pdf2docx` — local PDF → DOCX conversion: PDFium character-level
  extraction, pure-geometry layout analysis, rebuild through `docx-engine`;
  the same analysis drives the PDF app's PowerPoint and Excel exports.
- `packages/html2docx` — local HTML → DOCX conversion: the page is rendered
  in the app's own Chromium, reduced in-browser to a document intent tree, and
  written as native OOXML with the `docx` library. Drives the HTML app's
  Export as Word and Word `altChunk` handling in `docx-engine`.
- `packages/file-parse` — text extraction for the local file search index
  (office formats, text formats).
- `packages/i18n`, `packages/ui`, `packages/project-store`,
  `packages/electron-utils`, `packages/font-metrics` — shared i18n core, React
  UI kit, recent-files store, Electron main-process helpers and font metrics.

### Architecture notes (docx round trip)

```
open docx ─► archive original by hash (never touched)
          ─► docx-engine parses word/document.xml top-level elements (w:p / w:tbl / …)
          ─► Block tree, each block anchored by docxIndex + original XML slice
          ─► Tiptap editor (manual editing, dirty tracking)
save      ─► dirty blocks → OOXML fragments (referencing existing styles only)
          ─► splice into original document.xml (untouched blocks keep original bytes)
          ─► repack zip; all other entries copied byte-for-byte
```

The same philosophy holds in sheets and slides: the original file is the
source of truth, edits are applied as narrow patches, and everything the
editor did not touch survives the round trip untouched.

## Getting started

Prerequisites: Node 22+ (24 recommended), npm 10+, and a Rust toolchain
(`cargo` on PATH, needed only for the sheets xlsx sidecar). On Windows the
Rust MSVC target also needs the Visual Studio Build Tools C++ workload.

```bash
npm install
npm run fixtures     # generate test .docx fixtures (one-time, and after docx-engine changes)
npm run dev          # all editors + shell against Vite dev servers
npm run dev:docs     # or run a single app
```

## Checks every change must pass

CI runs these on every pull request; please run them locally first:

```bash
npm run format:check # Prettier check for uncommitted changed/new files
npm run lint         # ESLint across the repo (0 errors required; warnings allowed)
npm run typecheck    # tsc --noEmit across every workspace
npm test             # engine + app unit tests (also runs the Rust sidecar tests)
npm run licenses     # production dependency licenses within the permissive allowlist
```

## Coding conventions

- **English only** in code, comments, commit messages and repository docs.
  User-facing strings go through the i18n resources
  (`apps/*/src/renderer/i18n/`, plus the inline main-process dictionaries in
  `src/main/`), which are the only places non-English text belongs (plus test
  fixture text).
- TypeScript everywhere; avoid adding new `any` surfaces where a precise type
  is cheap.
- Tests live in `apps/*/tests` and `packages/*/tests` (vitest). New engine
  behavior needs a unit test; renderer-only UI tweaks generally don't.
- Keep files from growing without bound: if you are adding a substantial new
  concern to an already-large file, prefer a new module.
- Theming, i18n sharding and build gotchas are documented in
  [CLAUDE.md](CLAUDE.md) — read it before touching renderer CSS, i18n
  dictionaries or app main-process code.

## Commit and pull request guidelines

- Small, focused commits with imperative English subject lines
  (e.g. `fix docx table border round-trip`).
- A pull request should explain _why_ the change is needed and mention which
  of the checks above you ran.
- File format fidelity is the core product promise: for changes touching
  open/save paths (docx/xlsx/pptx), include a round-trip test proving that
  untouched content survives byte-for-byte.

## Reporting bugs and requesting features

Use the GitHub Issues of this repository. For suspected security issues, do
**not** open a public issue.

## Code of conduct

All community spaces follow the [Contributor Covenant](CODE_OF_CONDUCT.md);
participation implies acceptance.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
