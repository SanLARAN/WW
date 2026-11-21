import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GameState } from '../core/types';
import { loadProfile, profileLevel, type Profile } from '../core/profile';
import { Lobby, type LobbySettings } from './lobby';
import { Hud, type FeedItem } from './hud';
import { createStore, useStore } from './store';
import { Match } from '../game/game';
import { AudioEngine } from '../game/audio';
import { CutsceneOverlay } from './cutsceneOverlay';
import { Net } from '../net/net';

type Screen = 'lobby' | 'cutscene' | 'match' | 'over';

const gameState = createStore<GameState | null>(null);

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('lobby');
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [settings, setSettings] = useState<LobbySettings>({
    seed: 2027, bots: 2, difficulty: 1, host: false, roomCode: '', sensitivity: profile.sensitivity,
  });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [banner, setBanner] = useState<{ title: string; sub?: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hitmark, setHitmark] = useState(false);
  const [ads, setAds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [over, setOver] = useState<{ survived: number; kills: number; xp: number; level: number } | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('kotel.name') ?? 'Комбат');
  const [muted, setMuted] = useState(false);
  const [netStatus, setNetStatus] = useState('');
  /** when set, the next match starts after the cutscene */
  const pendingStart = useRef<null | 'solo'>(null);
  const [peers, setPeers] = useState<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const matchRef = useRef<Match | null>(null);
  const netRef = useRef<Net | null>(null);
  const audioRef = useRef<AudioEngine>(new AudioEngine());
  const feedId = useRef(0);
  const bannerTimer = useRef(0);
  const hitTimer = useRef(0);
  const s = useStore(gameState);

  // keep a reference for the net callbacks (they outlive a render)
  const seenCutscene = useRef(localStorage.getItem('kotel.cutscene') === '1');
  const cbRef = useRef({ setScreen, setOver, setPaused });
  cbRef.current = { setScreen, setOver, setPaused };

  const pushFeed = (text: string) => {
    const item = { id: ++feedId.current, text, t: performance.now() };
    setFeed((f) => [...f.slice(-8), item]);
    setTimeout(() => setFeed((f) => f.filter((x) => x.id !== item.id)), 6000);
  };

  const startMatch = (opts?: { seed?: number; bots?: number; difficulty?: number; net?: Net | null; host?: boolean }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    localStorage.setItem('kotel.name', name);
    const net = opts?.net ?? netRef.current;
    audioRef.current.start();
    audioRef.current.setMuted(muted);
    setScreen('match');
    setOver(null);
    setPaused(false);
    setFeed([]);
    // let the canvas mount before the engine grabs it
    requestAnimationFrame(() => {
      const match = new Match(canvas, {
        seed: opts?.seed ?? settings.seed,
        bots: opts?.bots ?? settings.bots,
        difficulty: opts?.difficulty ?? settings.difficulty,
        playerName: name,
        profile,
        net,
        host: opts?.host ?? true,
      }, {
        onState: (st) => {
          if (!(opts?.host ?? true) && matchRef.current) matchRef.current.adopt(st);
          gameState.set(st);
          const a = matchRef.current?.controller.adsAmount ?? 0;
          setAds((prev) => (Math.abs(prev - a) > 0.12 ? a : prev));
        },
        onKill: (text) => pushFeed(text),
        onBanner: (title, sub) => {
          setBanner({ title, sub });
          bannerTimer.current = window.setTimeout(() => setBanner(null), 4200);
        },
        onOver: (r) => {
          setOver(r);
          setScreen('over');
          const p = { ...loadProfile() };
          setProfile(p);
        },
        onHint: setHint,
        onHitmark: () => {
          setHitmark(true);
          clearTimeout(hitTimer.current);
          hitTimer.current = window.setTimeout(() => setHitmark(false), 90);
        },
        onPause: (p) => setPaused(p ?? true),
      });
      match.setSensitivity(settings.sensitivity);
      matchRef.current = match;
      const loop = (now: number) => {
        if (!matchRef.current) return;
        matchRef.current.frame(now);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  };

  const stopMatch = () => {
    matchRef.current?.dispose();
    matchRef.current = null;
    gameState.set(null);
    setCanvasKey((k) => k + 1);
  };

  const resume = () => {
    setPaused(false);
    matchRef.current?.input.lock();
    matchRef.current?.audio.resume();
  };

  // Esc closes the pause menu when it is the topmost layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && paused) { setPaused(false); matchRef.current?.input.lock(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [paused]);

  const connectNet = (host: boolean, code?: string, seed?: number, bots?: number, difficulty?: number) => {
    const net = new Net({
      onState: (st) => gameState.set(st),
      onPeers: (list) => setPeers(list.map((p) => p.name)),
      onStatus: setNetStatus,
      onWelcome: (m) => {
        setSettings((s2) => ({ ...s2, seed: m.seed, bots: m.bots, difficulty: m.difficulty }));
        startMatch({ seed: m.seed, bots: m.bots, difficulty: m.difficulty, net, host: false });
      },
      onEvent: (kind, data) => matchRef.current?.remoteEvent(kind, data),
      onRemoteInput: () => {},
      onPeerJoined: () => {},
      onYouAre: () => {},
    });
    netRef.current = net;
    if (host) net.host(code ?? settings.roomCode ?? randomCode(), seed ?? settings.seed, bots ?? settings.bots, difficulty ?? settings.difficulty);
    else net.join(settings.roomCode, name, profile.xp, profileLevel(profile));
  };

  const joinCode = () => { connectNet(false); };

  const me = useMemo(() => {
    const match = matchRef.current;
    if (!s || !match) return null;
    return s.soldiers.find((x) => x.id === match.me?.id) ?? match.me ?? null;
  }, [s]);

  return (
    <>
      <canvas key={canvasKey} ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }} />

      {screen === 'match' && s && (
        <Hud s={s} me={me} feed={feed} banner={banner} hint={hint} hitmark={hitmark} ads={ads} />
      )}

      {screen === 'lobby' && (
        <Lobby
          profile={profile}
          setProfile={(p) => { setProfile(p); }}
          settings={{ ...settings, sensitivity: settings.sensitivity }}
          setSettings={(v) => { setSettings(v); setProfile((p) => ({ ...p, sensitivity: v.sensitivity })); }}
          onStart={() => {
            if (!seenCutscene.current) {
              pendingStart.current = 'solo';
              setScreen('cutscene');
              return;
            }
            const net = netRef.current;
            const hosting = !!net && net.role === 'host';
            startMatch({ net: hosting ? net : null, host: true });
          }}
          onCutscene={() => setScreen('cutscene')}
          onHost={() => {
            const code = settings.roomCode || randomCode();
            setSettings((s2) => ({ ...s2, roomCode: code, host: true }));
            connectNet(true, code);
          }}
          onJoin={joinCode}
          netStatus={netStatus}
          peers={peers}
        />
      )}

      {screen === 'lobby' && (
        <div style={{ position: 'fixed', left: 24, bottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            class="field"
            style={{
              background: 'rgba(240,244,236,0.05)', border: '1px solid var(--line)', color: 'var(--ink)',
              fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.14em', padding: '8px 10px', outline: 'none',
            }}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value.slice(0, 14))}
            placeholder="позывной"
          />
          <button class="btn small" onClick={() => { setMuted((m) => !m); audioRef.current.setMuted(!muted); }}>
            {muted ? 'звук выкл' : 'звук вкл'}
          </button>
          <span class="muted" style={{ fontSize: 10 }}>позывной в отряде</span>
        </div>
      )}

      {screen === 'lobby' && netStatus && (
        <div style={{ position: 'fixed', right: 24, bottom: 22, fontSize: 10, letterSpacing: '0.18em', color: 'var(--ink-faint)', fontFamily: 'var(--mono)' }}>
          {netStatus}
        </div>
      )}

      {screen === 'cutscene' && (
        <CutsceneOverlay
          seed={settings.seed}
          onDone={() => {
            localStorage.setItem('kotel.cutscene', '1');
            seenCutscene.current = true;
            if (pendingStart.current) {
              pendingStart.current = null;
              const net = netRef.current;
              const hosting = !!net && net.role === 'host';
              startMatch({ net: hosting ? net : null, host: true });
            } else {
              setScreen('lobby');
            }
          }}
          audio={audioRef.current}
        />
      )}

      {paused && screen === 'match' && (
        <div class="overlay">
          <div class="menu" style={{ maxWidth: 460 }}>
            <div class="title" style={{ fontSize: 34 }}>ПАУЗА</div>
            <div class="subtitle">бой не останавливается в реальности</div>
            <div class="pause-grid">
              <button class="btn primary" onClick={resume}>Продолжить</button>
              <button class="btn" onClick={() => { setPaused(false); stopMatch(); setScreen('lobby'); }}>В лобби</button>
            </div>
            <div style={{ marginTop: 18 }} class="muted">
              <span class="kbd">WASD</span>движение <span class="kbd">SHIFT</span>бег <span class="kbd">CTRL</span>присесть{' '}
              <span class="kbd">ПКМ</span>прицел <span class="kbd">R</span>перезарядка <span class="kbd">F</span>ящик{' '}
              <span class="kbd">Q/E</span>оружие
            </div>
          </div>
        </div>
      )}

      {screen === 'over' && over && (
        <div class="overlay">
          <div class="menu" style={{ maxWidth: 560 }}>
            <div class="title" style={{ fontSize: 42 }}>КОТЁЛ ЗАКРЫТ</div>
            <div class="subtitle">связи нет. подкрепления нет.</div>
            <div class="statline">
              <div><b>{over.survived.toFixed(0)}</b><span>секунд</span></div>
              <div><b>{over.kills}</b><span>уничтожено</span></div>
              <div><b>+{over.xp}</b><span>опыта</span></div>
              <div><b>{over.level}</b><span>уровень</span></div>
            </div>
            <div style={{ marginTop: 24 }}>
              <button class="btn primary" onClick={() => { stopMatch(); startMatch(); }}>Ещё раз</button>
              <button class="btn" style={{ marginTop: 10 }} onClick={() => { stopMatch(); setScreen('lobby'); }}>В лобби</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function randomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}
