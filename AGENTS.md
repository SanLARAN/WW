# AGENTS.md — WorldWide (WW)

## Commands
- `npm run dev` — Vite dev server on :5173
- `npm run typecheck` — `tsc --noEmit` (strict, noUnused*)
- `npm run build` — typecheck + production build into `dist/`

## Verification
- Always run `npm run typecheck` and `npm run build` after changes.
- Visual checks: headless Edge via puppeteer-core works (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, args `--use-angle=d3d11 --enable-gpu`). In dev mode the controller is exposed as `window.ctl` (sim at `ctl.sim`, state at `ctl.sim.s`).
- Multiplayer can be tested without Supabase: two tabs of the same browser use the BroadcastChannel bus + WebRTC. Player id is per-tab (`sessionStorage`).

## Architecture notes
- Coordinates: lat/lon degrees; unit sphere radius 1; `toXYZ` matches `THREE.SphereGeometry` UVs.
- Province raster 4096x2048 generated at runtime in `src/world/worldgen.worker.ts` (deterministic, seeded). Province id in raster = index + 1, 0 = ocean.
- Globe palette texture rows: 0 owner rgb + owner idx, 1 controller rgb + controller idx, 2 fx (glow, player outline, pulse, political mix). Values are 0..255 bytes.
- Game state (`GameState`) must stay JSON-serialisable — it is gzipped and sent to clients. Behaviour lives in code (`data/events.ts`, `data/focus.ts`) referenced by id.
- All player actions go through `Command` → `applyCommand` (validated on the host).
- Sim tick = 1 game hour; daily hooks at `tick % 24 === 0`. Missiles fly in real seconds.
- Tier comparison: use `tierRank()` — never compare tier letters directly ('S' sorts after 'D').
- Large files: write with the file tool, not shell heredocs (they get truncated).
