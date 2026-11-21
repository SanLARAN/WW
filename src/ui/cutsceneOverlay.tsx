import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BEATS, playCutscene, type CutsceneHandle } from '../game/cutscene';
import { Engine } from '../render/engine';
import { buildSurfaces } from '../render/textures';
import { buildWorld } from '../render/world';
import { generateLayout } from '../world/layout';
import type { AudioEngine } from '../game/audio';

/**
 * DOM wrapper for the opening cutscene: owns the off-screen-ish canvas, the
 * timeline cards, the fade-to-black and the skip affordance.
 */
export function CutsceneOverlay(props: { seed: number; onDone: () => void; audio: AudioEngine }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const [card, setCard] = useState<{ tag: string; line: string } | null>(null);
  const [fade, setFade] = useState(0);
  const done = useRef(false);
  const handle = useRef<CutsceneHandle | null>(null);
  const finishRef = useRef(props.onDone);
  finishRef.current = props.onDone;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    props.audio.start();
    const engine = new Engine(canvas);
    const layout = generateLayout(props.seed);
    const surfaces = buildSurfaces();
    const world = buildWorld(layout, surfaces);
    engine.scene.add(world.root);

    let raf = 0;
    let last = performance.now();
    const cut = playCutscene(engine, layout, props.audio, () => {});
    handle.current = cut as CutsceneHandle & { setBeatHandler: (fn: (i: number) => void) => void };

    const onBeat = (i: number) => {
      const b = BEATS[i];
      if (!b) return;
      if (!b.text[0] && !b.text[1]) { setCard(null); return; }
      setCard({ tag: b.text[0], line: b.text[1] });
    };
    (handle.current as unknown as { setBeatHandler: (fn: (i: number) => void) => void }).setBeatHandler(onBeat);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const alive = cut.update(dt);
      const lens = cut.lens();
      setFade(lens.fade);
      if (!alive && !done.current) {
        done.current = true;
        cut.dispose();
        engine.renderer.dispose();
        cancelAnimationFrame(raf);
        finishRef.current();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const skip = () => {
      if (done.current) return;
      done.current = true;
      cut.skip();
      cut.dispose();
      engine.renderer.dispose();
      cancelAnimationFrame(raf);
      finishRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') skip();
    };
    addEventListener('keydown', onKey);
    canvas.addEventListener('click', skip);

    return () => {
      removeEventListener('keydown', onKey);
      canvas.removeEventListener('click', skip);
      cancelAnimationFrame(raf);
      if (!done.current) cut.dispose();
      engine.renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class="cut cut-bars">
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {card && (
        <div class="cut-card" key={card.line}>
          {card.tag && <h3>{card.tag}</h3>}
          <p>{card.line}</p>
        </div>
      )}
      <button class="cut-skip" onClick={() => handle.current?.skip()}>пропустить · esc</button>
      <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: fade, pointerEvents: 'none' }} />
    </div>
  );
}
