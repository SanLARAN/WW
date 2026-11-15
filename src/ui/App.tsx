import { useState } from 'preact/hooks';
import { useCtl } from './util';
import { Loading, MainMenu, CountrySelect, Lobby, SettingsModal } from './screens';
import { Hud } from './hud';

export function App() {
  const c = useCtl();
  const [settings, setSettings] = useState(false);
  return (
    <>
      {c.screen === 'loading' && <Loading />}
      {c.screen === 'menu' && <MainMenu onSettings={() => setSettings(true)} />}
      {c.screen === 'select' && <CountrySelect />}
      {c.screen === 'lobby' && <Lobby />}
      {c.screen === 'game' && <Hud />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </>
  );
}
