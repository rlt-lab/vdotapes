# Repository Guidelines

## Project Structure & Module Organization

- `app/`: Renderer UI (`index.html`, `renderer.js`, `styles.css`, assets). Keep renderer-only code here.
- `src/`: Main/IPC/database logic (`main.js`, `preload.js`, `ipc-handlers.js`, `database.js`, scanners, utilities). Keep Node/Electron-only code here.
- `docs/`: Architecture and optimization notes.
- `dist/`: Build outputs from electron-builder; do not edit.
- Naming: files use kebab-case (e.g., `video-smart-loader.js`), classes PascalCase, variables camelCase.

## Build, Test, and Development Commands

- `npm install`: Install dependencies.
- `npm run dev`: Launch Electron with DevTools enabled.
- `npm start`: Launch app in development mode.
- `npm run build`: Package for current platform into `dist/`.
- `npm run build:mac` / `npm run build:win`: Platform-specific builds.
- `npm run pack`: Create an unpacked build for quick local testing.

Run all commands from the repository root.

## Coding Style & Naming Conventions

- JavaScript: 2-space indentation, semicolons, single quotes.
- Keep modules focused; prefer small, pure helpers in `src/`.
- Renderer-only code stays in `app/`; main/IPC-only code in `src/`.
- Security: avoid `eval`, remote content, and enabling Node in the renderer.
- Async: prefer `async/await` with explicit error handling and user-friendly messages.

## Testing Guidelines

- No formal test runner yet. Provide manual QA steps in PRs (OS, steps to reproduce/verify, expected vs actual).
- Validate core flows: folder selection, scan/index, grid browsing, autoplay previews, favorites, filters/sorting.
- For performance work, include before/after notes (FPS, memory, DB timings) and sample data size.

## Commit & Pull Request Guidelines

- Commits: short, imperative, and scoped (e.g., "Improve sorting and UI controls"). Group related changes.
- PRs must include: clear description, rationale, screenshots/GIFs for UI, platform(s) tested, and migration notes; link related issues.
- Keep diffs minimal and update `README.md`/`docs/` when behavior changes.

## Security & Configuration Tips

- Electron security enforced: `contextIsolation` on, `nodeIntegration` off. Do not bypass.
- IPC: validate inputs and return structured results `{ success, error, data }`.
- Database: uses `better-sqlite3`; keep heavy queries indexed and off the renderer thread.
- Packaging: icons/assets live in `app/assets/`; builder config resides in `package.json`.
