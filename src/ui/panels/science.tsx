import { ctl } from '../../client/controller';
import { BRANCHES, TECHS } from '../../data/tech';
import { focusAvailable, focusTree } from '../../data/focus';
import { click } from '../util';

export function ResearchPanel() {
  const c = ctl.country!;
  const cur = c.research;
  const curTech = cur ? TECHS.find((t) => t.id === cur.id) : null;
  return (
    <div class="col">
      <div class="row between small">
        <span>Очки исследований: <b class="mono">{c.rp.toFixed(1)}</b>/день · изучено <b class="mono">{c.researched.length}</b>/{TECHS.length}</span>
        {curTech && cur && <span class="accent">⏳ {curTech.name} — {Math.ceil((curTech.cost - cur.progress) / Math.max(0.1, c.rp))} дн.</span>}
      </div>
      {curTech && cur && <div class="bar"><i style={{ width: `${(cur.progress / curTech.cost) * 100}%` }} /></div>}
      <div class="tree" style={{ gridTemplateColumns: `repeat(${BRANCHES.length}, minmax(0, 1fr))` }}>
        {BRANCHES.map((b) => (
          <div class="tech-col" key={b.id}>
            <h3 class="sub">{b.icon} {b.name}</h3>
            {TECHS.filter((t) => t.branch === b.id).sort((x, y) => x.tier - y.tier).map((t) => {
              const done = c.researched.includes(t.id);
              const avail = !done && t.req.every((r) => c.researched.includes(r));
              const isCur = cur?.id === t.id;
              const days = Math.ceil(t.cost / Math.max(0.1, c.rp));
              return (
                <button key={t.id} class={`tech ${done ? 'done' : isCur ? 'cur' : avail ? 'avail' : 'lock'}`} disabled={!avail || isCur} title={t.desc}
                  onClick={click(() => ctl.dispatch({ t: 'research', id: t.id }))}>
                  <b>{done ? '✓ ' : ''}{t.name}</b>
                  <span>{done ? 'Изучено' : `${t.cost} ОИ · ~${days} дн.`}</span>
                  <div class="tiny muted" style={{ marginTop: 4 }}>{t.desc}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FocusPanel() {
  const c = ctl.country!;
  const tree = focusTree(c.id);
  const W = 148, H = 104;
  const maxX = Math.max(...tree.map((f) => f.x)), maxY = Math.max(...tree.map((f) => f.y));
  const cur = c.focus ? tree.find((f) => f.id === c.focus!.id) : null;
  return (
    <div class="col">
      <div class="small">{cur && c.focus ? <span class="accent">⏳ {cur.name} — осталось {cur.days - c.focus.progress} дн.</span> : <span class="muted">Выберите национальный фокус. Он выполняется в фоне и даёт постоянные эффекты.</span>}</div>
      {cur && c.focus && <div class="bar"><i style={{ width: `${(c.focus.progress / cur.days) * 100}%` }} /></div>}
      <div style={{ overflow: 'auto' }}>
        <div class="focus-grid" style={{ width: (maxX + 1) * W, height: (maxY + 1) * H }}>
          <svg width={(maxX + 1) * W} height={(maxY + 1) * H} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
            {tree.flatMap((f) => (f.req ?? []).map((r) => {
              const p = tree.find((x) => x.id === r);
              if (!p) return null;
              return <line key={f.id + r} x1={p.x * W + 66} y1={p.y * H + 74} x2={f.x * W + 66} y2={f.y * H} stroke={c.focusDone.includes(r) ? 'rgba(73,194,124,0.6)' : 'rgba(160,190,220,0.25)'} stroke-width="2" />;
            }))}
          </svg>
          {tree.map((f) => {
            const done = c.focusDone.includes(f.id);
            const isCur = c.focus?.id === f.id;
            const err = focusAvailable(c, f);
            const excluded = !!f.excl?.some((e) => c.focusDone.includes(e));
            return (
              <button key={f.id} class={`focus${done ? ' done' : isCur ? ' cur' : excluded ? ' excl' : err ? ' lock' : ''}`} style={{ left: f.x * W, top: f.y * H }}
                disabled={!!err || !!c.focus} title={`${f.desc}\n${f.days} дн.${err && !done ? `\n${err}` : ''}`}
                onClick={click(() => ctl.dispatch({ t: 'focus', id: f.id }))}>
                <span class="fi" aria-hidden="true">{f.icon}</span>
                <b>{f.name}</b>
                <span class="tiny muted">{done ? 'выполнен' : `${f.days} дн.`}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
