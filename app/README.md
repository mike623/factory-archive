# app/

The Factory Archive desktop app: a Tauri 2 shell (`src-tauri/`, Rust) around a React 19 + TypeScript + Vite UI (`src/`).

- User docs, download, development setup and releasing: [`../README.md`](../README.md)
- Conventions and rules for contributors and coding agents: [`../AGENTS.md`](../AGENTS.md)

```bash
npm install
npm run tauri dev               # desktop app
npm run dev                     # UI only, in the browser (sample data; ?disk / ?empty previews)
cd src-tauri && cargo test      # Rust tests (offline)
```
