import { useState } from 'preact/hooks';
import { ctl } from '../../client/controller';
import { OPS_INFO, type OpAction } from '../../game/commands';
import { DOCTRINES, UNLOCKS, OPS_CAP, opsPoints, opsCooldown } from '../../game/strategy';
import { click } from '../util';

const OP_ORDER: OpAction[] = ['strike', 'supply', 'pressure', 'influence', 'sabotage', 'fortify'];

/** One screen, three decisions: doctrine, upgrades, instant operations. */
export function OpsPanel() {
  const sim = ctl.sim!, c = ctl.country!;
  const [tab, setTab] = useState<'ops' | 'doctrine' | 'unlocks'>('ops');
  const pts = opsPoints(sim, c);
  const enemies = sim.enemiesOf(c.id).map((e) => sim.c(e)).filter(Boolean);
  const [target, setTarget] = useState<string | null>(enemies[0]?.id ?? null);

  const targets = tab === 'ops' && OP_ORDER.some((o) => OPS_INFO[o].target === 'enemy')
    ? [...new Map([...enemies, ...neighbours(), ...(target ? [sim.c(target)] : [])].filter(Boolean).map((x) => [x!.id, x!])).values()]
    : Object.values(sim.s.countries).filter((x) => x.alive && x.id !== c.id).sort((a, b) => b.gdp - a.gdp).slice(0, 24);

  const eff = target ? sim.c(target) : null;

  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section row between">
        <div class="row" style={{ gap: 6 }}>
          {([['ops', '⚡ Операции'], ['doctrine', '📜 Доктрина'], ['unlocks', '🛠 Модернизация']] as const).map(([k, n]) => (
            <button key={k} class={`btn sm${tab === k ? ' on' : ''}`} onClick={click(() => setTab(k))}>{n}</button>
          ))}
        </div>
        <div class="ops-pips" title={`Оперативные очки: ${pts} из ${OPS_CAP}`}>
          {Array.from({ length: OPS_CAP }, (_, i) => <i key={i} class={i < pts ? 'on' : ''} />)}
        </div>
      </div>

      {tab === 'ops' && (
        <>
          <div class="section col" style={{ gap: 6 }}>
            <h3 class="sub">Цель</h3>
            <div class="op-targets">
              {targets.map((t) => (
                <button key={t!.id} class={`op-target${target === t!.id ? ' on' : ''}`} onClick={click(() => setTarget(t!.id))}>
                  <span class="swatch" style={{ background: t!.color }} />
                  <span class="grow">{t!.name}</span>
                  {sim.atWar(c.id, t!.id) && <span class="tiny danger">война</span>}
                  {sim.militaryAllies(c.id).includes(t!.id) && <span class="tiny" style={{ color: 'var(--info)' }}>союзник</span>}
                </button>
              ))}
            </div>
          </div>
          <div class="section">
            <h3 class="sub">Действия</h3>
            <div class="op-grid">
              {OP_ORDER.map((op) => {
                const info = OPS_INFO[op];
                const cd = opsCooldown(sim, c, op);
                const enemyOk = info.target !== 'enemy' || (eff ? sim.atWar(c.id, eff.id) : false);
                const allyOnly = op === 'fortify' && eff && !sim.militaryAllies(c.id).includes(eff.id) && eff.id !== c.id;
                const why = !eff ? 'Выберите цель' : cd > 0 ? `Перезарядка ${cd} ч` : pts < info.ops ? `Нужно ${info.ops} очка` : !enemyOk ? 'Только против врага по войне' : allyOnly ? 'Только своя страна или союзник' : '';
                return (
                  <button key={op} class={`op-card${why ? ' off' : ''}`} disabled={!!why} title={why || info.desc}
                    onClick={click(() => {
                      if (op === 'fortify') { ctl.dispatch({ t: 'buildBuilding', building: 'bunker', province: c.capital }); return; }
                      ctl.dispatch({ t: 'ops', op, target: eff!.id });
                    })}>
                    <span class="op-ico">{info.icon}</span>
                    <b>{info.name}</b>
                    <span class="tiny muted">{info.desc}</span>
                    <span class="op-cost">{'◆'.repeat(info.ops)}</span>
                  </button>
                );
              })}
            </div>
            {eff && (
              <div class="op-brief">
                <div class="row between small"><span class="muted">Стабильность цели</span><b class="mono">{eff.stability.toFixed(0)}</b></div>
                <div class="bar danger"><i style={{ width: `${eff.stability}%` }} /></div>
                <div class="row between small" style={{ marginTop: 4 }}><span class="muted">Отношения</span><b class={`mono ${sim.rel(c.id, eff.id) < 0 ? 'danger' : 'ok'}`}>{sim.rel(c.id, eff.id).toFixed(0)}</b></div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'doctrine' && (
        <div class="section col" style={{ gap: 8 }}>
          <h3 class="sub">Военная доктрина · выбирается один раз на 90 дней</h3>
          {DOCTRINES.map((d) => {
            const on = c.doctrine === d.id;
            const locked = !on && c.doctrinePaid > sim.s.tick;
            return (
              <button key={d.id} class={`doctrine${on ? ' on' : ''}`} disabled={locked && !on}
                onClick={click(() => ctl.dispatch({ t: 'doctrine', id: d.id }))}>
                <span class="d-ico">{d.icon}</span>
                <div class="col" style={{ gap: 2 }}>
                  <b>{d.name}{on ? ' · принята' : ''}</b>
                  <span class="tiny muted">{d.desc}</span>
                </div>
              </button>
            );
          })}
          {c.doctrinePaid > sim.s.tick && <span class="tiny muted">Смена станет доступна через {Math.ceil((c.doctrinePaid - sim.s.tick) / 24)} дн.</span>}
        </div>
      )}

      {tab === 'unlocks' && (
        <div class="section col" style={{ gap: 8 }}>
          <div class="row between">
            <h3 class="sub" style={{ margin: 0 }}>Очки модернизации</h3>
            <b class="mono accent">{c.unlockPoints}</b>
          </div>
          <span class="tiny muted">Очки дают военные заводы и лаборатории. Открытые модификации действуют навсегда.</span>
          <div class="unlock-grid">
            {UNLOCKS.map((u) => {
              const owned = c.unlocks.includes(u.id);
              const hasTech = c.researched.includes(u.tech);
              return (
                <button key={u.id} class={`unlock${owned ? ' owned' : ''}${!hasTech && !owned ? ' lock' : ''}`}
                  disabled={owned || !hasTech || c.unlockPoints < u.cost}
                  title={owned ? 'Уже открыто' : !hasTech ? 'Сначала исследуйте технологию' : u.desc}
                  onClick={click(() => ctl.dispatch({ t: 'unlock', id: u.id }))}>
                  <span class="u-ico">{u.icon}</span>
                  <b>{u.name}</b>
                  <span class="tiny muted">{u.desc}</span>
                  <span class="u-cost">{owned ? '✓' : `◆ ${u.cost}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function neighbours() {
  const sim = ctl.sim!, c = ctl.country!;
  const out: NonNullable<ReturnType<typeof sim.c>>[] = [];
  const seen = new Set<string>();
  for (const p of sim.ownedProvinces(c.id)) {
    for (const n of ctl.world.provinces[p].neighbors) {
      const o = sim.s.prov.ctrl[n];
      if (o === c.id || seen.has(o) || o === '010') continue;
      seen.add(o);
      const cc = sim.c(o);
      if (cc?.alive) out.push(cc);
    }
  }
  return out;
}
