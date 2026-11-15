import { useState } from 'preact/hooks';
import { ctl } from '../../client/controller';
import { ALLIANCE_INFO } from '../../data/countries';
import { CASUS_BELLI, DIPLO_INFO, type DiploAction } from '../../game/commands';
import { money, click } from '../util';

const GROUPS: [string, DiploAction[]][] = [
  ['Отношения', ['improve', 'insult', 'alliance', 'guarantee']],
  ['Экономика', ['sanction', 'unsanction', 'lendlease']],
  ['Спецоперации', ['spy', 'propaganda', 'proxy', 'cyber', 'coup']],
  ['Сила', ['ultimatum', 'volunteers', 'war']],
];

export function DiplomacyPanel() {
  const sim = ctl.sim!, me = ctl.country!;
  const [q, setQ] = useState('');
  const [cb, setCb] = useState('claims');
  const target = ctl.inspectCountry && ctl.inspectCountry !== me.id ? sim.c(ctl.inspectCountry) : null;
  const all = Object.values(sim.s.countries).filter((c) => c.alive && c.id !== me.id && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  all.sort((a, b) => (sim.atWar(me.id, b.id) ? 1 : 0) - (sim.atWar(me.id, a.id) ? 1 : 0) || b.gdp - a.gdp);
  const offers = me.flags.filter((f) => f.startsWith('peaceoffer_'));
  return (
    <div class="row" style={{ alignItems: 'stretch', gap: 12, height: '100%' }}>
      <div class="col" style={{ width: 200, minHeight: 0 }}>
        <input type="search" placeholder="Страна…" aria-label="Поиск страны" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <div style={{ overflow: 'auto', flex: 1 }}>
          {all.slice(0, 200).map((c) => {
            const r = sim.rel(me.id, c.id);
            const war = sim.atWar(me.id, c.id);
            return (
              <button key={c.id} class={`country-row${target?.id === c.id ? ' sel' : ''}`} style={{ padding: '6px 8px' }} onClick={click(() => { ctl.inspectCountry = c.id; ctl.bump(); })}>
                <span class="swatch" style={{ background: c.color }} />
                <span class="grow small">{c.name}{c.player ? ' 👤' : ''}</span>
                <span class={`mono tiny ${war ? 'danger' : r > 30 ? 'ok' : r < -30 ? 'danger' : 'muted'}`}>{war ? '⚔' : Math.round(r)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div class="grow col" style={{ minWidth: 0, overflow: 'auto' }}>
        {offers.map((f) => {
          const [, from, kind] = f.split('_');
          const fc = sim.c(from);
          return fc ? (
            <div class="card" key={f} style={{ borderColor: 'var(--accent)' }}>
              <b class="small">🕊 {fc.name} предлагает {kind === 'peace' ? 'белый мир' : 'мир с аннексией оккупированного'}</b>
              <div class="row"><button class="btn sm primary" onClick={click(() => ctl.dispatch({ t: 'diplo', action: 'acceptPeace', target: from }))}>Принять</button>
                <button class="btn sm" onClick={click(() => ctl.dispatch({ t: 'diplo', action: 'declinePeace', target: from }))}>Отклонить</button></div>
            </div>
          ) : null;
        })}
        {!target && <div class="muted small">Выберите страну в списке или кликните по ней на карте.</div>}
        {target && (() => {
          const r = sim.rel(me.id, target.id);
          const war = sim.atWar(me.id, target.id);
          const ally = sim.militaryAllies(me.id).includes(target.id);
          return (
            <>
              <div class="row"><span class="swatch" style={{ background: target.color, width: 20, height: 14 }} /><h2 class="big-name" style={{ fontSize: 22 }}>{target.name}</h2></div>
              <div class="small muted">{target.leader} · ВВП {money(target.gdp)} · стабильность {target.stability.toFixed(0)}{target.player ? ` · игрок ${sim.s.players[target.player]?.name ?? ''}` : ' · ИИ'}</div>
              <div class="row wrap">
                {war && <span class="chip war">В состоянии войны</span>}
                {ally && <span class="chip ally">Военный союзник</span>}
                {me.sanctions.includes(target.id) && <span class="chip">Под нашими санкциями</span>}
                {target.sanctions.includes(me.id) && <span class="chip war">Санкции против нас</span>}
                {target.alliances.map((a) => <span class="chip" key={a}>{ALLIANCE_INFO[a]?.name ?? 'Союз'}</span>)}
              </div>
              <div>
                <div class="row between tiny muted"><span>Война −100</span><span class="mono">{Math.round(r)}</span><span>Союз +100</span></div>
                <div class="relbar"><i style={{ left: `${(r + 100) / 2}%` }} /></div>
              </div>
              {war ? (
                <div class="card">
                  <b class="small">Война</b>
                  <div class="row wrap">
                    <button class="btn sm" onClick={click(() => ctl.dispatch({ t: 'diplo', action: 'peace', target: target.id }))}>Белый мир</button>
                    <button class="btn sm" onClick={click(() => ctl.dispatch({ t: 'diplo', action: 'peaceAnnex', target: target.id }))}>Потребовать капитуляции</button>
                    <button class="btn sm" onClick={click(() => ctl.dispatch({ t: 'diplo', action: 'callAllies', target: target.id }))}>Призвать союзников</button>
                  </div>
                </div>
              ) : null}
              {GROUPS.map(([name, acts]) => (
                <div key={name} class="col" style={{ gap: 4 }}>
                  <h3 class="sub" style={{ marginTop: 8 }}>{name}</h3>
                  {acts.map((a) => {
                    const info = DIPLO_INFO[a];
                    if (a === 'war' && war) return null;
                    return (
                      <div class="row" key={a}>
                        <button class={`btn sm ${info.hostile ? 'danger' : ''}`} style={{ width: 210, justifyContent: 'flex-start' }} onClick={click(() => ctl.dispatch({ t: 'diplo', action: a, target: target.id, arg: a === 'war' ? cb : undefined }))}>{info.name}</button>
                        <span class="tiny muted grow">{info.desc}{info.cost ? ` ${money(info.cost)}.` : ''}</span>
                      </div>
                    );
                  })}
                  {name === 'Сила' && !war && (
                    <label class="row tiny muted">Повод (casus belli):
                      <select value={cb} onChange={(e) => setCb((e.target as HTMLSelectElement).value)}>{Object.entries(CASUS_BELLI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    </label>
                  )}
                </div>
              ))}
              {sim.s.wars.some((w) => sim.sideOf(w, target.id)) && !war && (
                <button class="btn sm" onClick={click(() => ctl.dispatch({ t: 'diplo', action: 'joinWar', target: target.id }))}>Вступить в войну на их стороне</button>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
