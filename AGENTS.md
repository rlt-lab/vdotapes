# Repository Guidelines

## Project Structure & Modules
- `app/`: Renderer UI (`index.html`, `renderer.js`, `styles.css`, assets).
- `src/`: Main/IPC/database logic (`main.js`, `preload.js`, `ipc-handlers.js`, `database.js`, scanners and utilities).
- `docs/`: Architecture and optimization notes.
- `dist/`: Build outputs (created by electron-builder).
- Naming: files use kebab-case (e.g., `video-smart-loader.js`), classes PascalCase, variables camelCase.

## Build, Test, and Development
- `npm install`: Install dependencies.
- `npm run dev`: Launch Electron with DevTools.
- `npm start`: Launch app in development mode.
- `npm run build`: Package app for current platform into `dist/`.
- `npm run build:mac` / `npm run build:win`: Platform-specific builds.
- `npm run pack`: Unpacked build for quick local testing.

## Coding Style & Conventions
- JavaScript (Node/Electron): 2-space indentation, semicolons, single quotes.
- Keep modules focused; prefer small, pure helpers in `src/`.
- Renderer-only code stays in `app/`; main/IPC-only code in `src/`.
- Avoid `eval`, remote content, or enabling Node in the renderer.
- Prefer async/await with explicit error handling and user-friendly messages.

## Testing Guidelines
- No formal test runner yet. Provide manual QA steps in PRs (OS, steps to reproduce/verify, expected vs actual).
- Validate core flows: folder selection, scan/index, grid browsing, autoplay previews, favorites, filters/sorting.
- For performance work, include before/after notes (FPS, memory, DB timings) and sample data size.

## Commit & Pull Requests
- Commits: short, imperative, and scoped (e.g., "Improve sorting and UI controls"). Group related changes.
- PRs must include: clear description, rationale, screenshots/GIFs for UI, platform(s) tested, and any migration notes.
- Link related issues. Keep diffs minimal; update `README.md`/`docs/` when behavior changes.

## Security & Configuration Tips
- Electron security is enforced (contextIsolation on, nodeIntegration off). Do not bypass.
- IPC: validate inputs and return structured results (`{ success, error, data }`).
- Database: uses `better-sqlite3`; keep heavy queries indexed and off the renderer thread.
- Packaging: icons/assets live in `app/assets/`; builder config resides in `package.json`.
