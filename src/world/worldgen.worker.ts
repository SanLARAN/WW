/// <reference lib="webworker" />
import { generate } from './worldgen';
import type { WorldGenInput } from './worldTypes';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorldGenInput>) => {
  const out = generate(e.data, (msg, p) => ctx.postMessage({ type: 'progress', msg, p }));
  const transfer = [
    out.prov.buffer, out.ctry.buffer, out.nav.buffer, out.pLat.buffer, out.pLon.buffer, out.pArea.buffer,
    out.pCountry.buffer, out.pTerrain.buffer, out.pCoastal.buffer, out.pElev.buffer, out.pLight.buffer,
    out.adjOffsets.buffer, out.adjList.buffer,
  ] as ArrayBuffer[];
  ctx.postMessage({ type: 'done', out }, transfer);
};
