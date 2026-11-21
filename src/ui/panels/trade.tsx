import { useState } from 'preact/hooks';
import { ctl } from '../../client/controller';
import { RESOURCE_INFO, type ResourceKey } from '../../data/resources';
import { trade, RES_KEYS, topPartners, routeBlocked, priceFor, SECTORS, type Sector } from '../../game/trade';
import { companyCost } from '../../game/commands';
import { money, click } from '../util';

const SECTOR_ORDER: Sector[] = ['energy', 'industry', 'food', 'tech'];

/** Sparkline from the last 30 daily prices. */
function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return <span class="dim tiny">—</span>;
  const min = Math.min(...data), max = Math.max(...data), span = Math.max(1e-6, max - min);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg class={`spark ${up ? 'up' : 'down'}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

export function TradePanel() {
  const sim = ctl.sim!, c = ctl.country!;
  const t = trade(sim);
  const [tab, setTab] = useState<'markets' | 'deals' | 'companies'>('markets');
  const [res, setRes] = useState<ResourceKey>('oil');
  const partners = topPartners(sim, c);
  const mine = t.routes.filter((r) => r.a === c.id || r.b === c.id);
  const companies = t.companies.filter((x) => x.owner === c.id);

  const candidates = Object.values(sim.s.countries)
    .filter((o) => o.alive && o.id !== c.id && !t.routes.some((r) => r.res === res && ((r.a === c.id && r.b === o.id) || (r.b === c.id && r.a === o.id))))
    .map((o) => ({ c: o, rel: sim.rel(c.id, o.id), blocked: routeBlocked(sim, c.id, o.id) }))
    .sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || b.rel - a.rel || b.c.gdp - a.c.gdp)
    .slice(0, 14);

  const cost = companyCost(sim, c);

  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section row between">
        <div class="row" style={{ gap: 6 }}>
          {([['markets', '📈 Рынки'], ['deals', '🤝 Соглашения'], ['companies', '🏢 Компании']] as const).map(([k, n]) => (
            <button key={k} class={`btn sm${tab === k ? ' on' : ''}`} onClick={click(() => setTab(k))}>{n}</button>
          ))}
        </div>
        <span class="small muted">Казна <b class="mono">{money(c.budget)}</b></span>
      </div>

      {tab === 'markets' && (
        <>
          <div class="section">
            <h3 class="sub">Мировые рынки · цена, спрос и предложение</h3>
            <div class="market-grid">
              {RES_KEYS.map((r) => {
                const m = t.markets[r];
                const q = priceFor(sim, c, r);
                const surplus = (c.prod[r] ?? 0) - (c.use[r] ?? 0);
                const scale = Math.max(1, (m.supply + m.demand) / 2);
                const heat = Math.max(0, Math.min(1, m.demand / Math.max(1, m.supply)));
                return (
                  <div class="market-card" key={r}>
                    <div class="row between">
                      <b class="small">{RESOURCE_INFO[r].icon} {RESOURCE_INFO[r].name}</b>
                      <span class={`mono tiny ${m.price >= m.prev ? 'ok' : 'danger'}`}>{m.price.toFixed(2)}×</span>
                    </div>
                    <Spark data={t.history[r] ?? []} />
                    <div class="market-heat" title={`Спрос ${Math.round(m.demand)} / предложение ${Math.round(m.supply)}`}>
                      <i style={{ width: `${heat * 100}%` }} />
                    </div>
                    <div class="row between tiny">
                      <span class={surplus >= 0 ? 'ok' : 'danger'}>{surplus >= 0 ? 'излишек' : 'дефицит'} {Math.abs(surplus).toFixed(1)}</span>
                      <span class="muted">вам: покупка {q.buy.toFixed(2)}× · продажа {q.sell.toFixed(2)}×</span>
                    </div>
                    <div class="tiny muted">запас {Math.max(0, c.stock[r]).toFixed(0)} / 300 · масштаб рынка {Math.round(scale)}</div>
                  </div>
                );
              })}
            </div>
            <span class="tiny muted">Цена = мировое предложение против спроса. Излишки сверх 300 продаются, дефицит покупается по цене покупки. Соглашения улучшают условия.</span>
          </div>
          {partners.length > 0 && (
            <div class="section col" style={{ gap: 4 }}>
              <h3 class="sub">Лучшие партнёры</h3>
              {partners.map((p) => {
                const o = sim.c(p.id);
                return (
                  <div class="row between small" key={p.id}>
                    <span class="row"><span class="swatch" style={{ background: o?.color }} />{o?.name}</span>
                    <span class="mono ok">+{money(p.value)}/д</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'deals' && (
        <>
          <div class="section col" style={{ gap: 6 }}>
            <h3 class="sub">Заключить соглашение</h3>
            <div class="row wrap">
              {RES_KEYS.map((r) => (
                <button key={r} class={`btn sm${res === r ? ' on' : ''}`} onClick={click(() => setRes(r))}>
                  {RESOURCE_INFO[r].icon} {RESOURCE_INFO[r].name}
                </button>
              ))}
            </div>
            <div class="deal-list">
              {candidates.map(({ c: o, rel, blocked }) => (
                <button key={o.id} class={`deal-row${blocked ? ' blocked' : ''}`} disabled={!!blocked}
                  title={blocked ?? `Отношения ${rel.toFixed(0)} · ВВП ${money(o.gdp)}`}
                  onClick={click(() => ctl.dispatch({ t: 'trade', partner: o.id, res }))}>
                  <span class="swatch" style={{ background: o.color }} />
                  <span class="grow">{o.name}</span>
                  <span class={`tiny ${rel < 0 ? 'danger' : 'ok'}`}>{rel.toFixed(0)}</span>
                  <span class="tiny muted">{blocked ?? 'предложить'}</span>
                </button>
              ))}
            </div>
            <span class="tiny muted">Холодные отношения — отказ. Война и санкции рвут маршрут. Каждое соглашение: +6 к отношениям и лучшая цена.</span>
          </div>
          <div class="section col" style={{ gap: 4 }}>
            <h3 class="sub">Ваши маршруты ({mine.length})</h3>
            {mine.length === 0 && <span class="muted small">Маршрутов нет: экономика работает по мировым ценам, без скидок и премий.</span>}
            {mine.map((r) => {
              const other = r.a === c.id ? r.b : r.a;
              const o = sim.c(other);
              const blocked = routeBlocked(sim, c.id, other);
              return (
                <div class={`route-row${blocked ? ' blocked' : ''}`} key={r.id}>
                  <span>{RESOURCE_INFO[r.res].icon}</span>
                  <span class="grow small">{o?.name ?? other}</span>
                  <span class="tiny muted">{blocked ?? 'действует'}</span>
                  <button class="btn sm ghost danger" aria-label="Расторгнуть" onClick={click(() => ctl.dispatch({ t: 'routeClose', id: r.id }))}>✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'companies' && (
        <>
          <div class="section col" style={{ gap: 6 }}>
            <div class="row between">
              <h3 class="sub" style={{ margin: 0 }}>Основать компанию</h3>
              <span class="small mono">цена: {money(cost)}</span>
            </div>
            <div class="cards">
              {SECTOR_ORDER.map((s) => {
                const sec = SECTORS[s];
                const owned = companies.filter((x) => x.sector === s).length;
                return (
                  <div class="card" key={s}>
                    <div class="row between"><b class="small">{sec.icon} {sec.name}</b>{owned > 0 && <span class="tiny ok">×{owned}</span>}</div>
                    <span class="tiny muted" style={{ minHeight: 30 }}>{sec.desc}</span>
                    <span class="tiny mono">{Object.entries(sec.mods).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ')}</span>
                    <button class="btn sm" disabled={c.budget < cost} onClick={click(() => ctl.dispatch({ t: 'company', sector: s }))}>Основать</button>
                  </div>
                );
              })}
            </div>
            <span class="tiny muted">Дивиденды растут около трёх лет, потом выходят на плато. Продажа возвращает 90% вложенного, но бонус сектора снимается.</span>
          </div>
          <div class="section col" style={{ gap: 4 }}>
            <h3 class="sub">Ваши компании ({companies.length})</h3>
            {!companies.length && <span class="muted small">Пока нет. Компании — долгий доход: вкладывайте, когда казна свободна.</span>}
            {companies.map((co) => {
              const sec = SECTORS[co.sector];
              const age = Math.max(0, (sim.s.tick - co.founded) / 24);
              const div = co.capital * 0.0016 * (1 + Math.min(0.5, age / 1200));
              return (
                <div class="route-row" key={co.id}>
                  <span>{sec.icon}</span>
                  <div class="col grow" style={{ gap: 1 }}>
                    <span class="small">{co.name}</span>
                    <span class="tiny muted">{Math.round(age)} дн. · капитал {money(co.capital)}</span>
                  </div>
                  <span class="mono tiny ok">+{money(div)}/д</span>
                  <button class="btn sm ghost danger" aria-label="Продать" title="Продать за 90% стоимости"
                    onClick={click(() => { if (confirm(`Продать «${co.name}» за ${money(co.capital * 0.9)}?`)) ctl.dispatch({ t: 'companyClose', id: co.id }); })}>✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
