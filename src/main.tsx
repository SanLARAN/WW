import { render } from 'preact';
import './ui/styles.css';
import { App } from './ui/App';
import { ctl } from './client/controller';
import { audio } from './audio/audio';

render(<App />, document.getElementById('app')!);

const canvas = document.getElementById('scene') as HTMLCanvasElement;
ctl.init(canvas).catch((e) => {
  console.error(e);
  ctl.loading = { msg: 'Ошибка загрузки: ' + (e instanceof Error ? e.message : String(e)) + '. Нужен браузер с WebGL2.', p: 0 };
  ctl.bump();
});

// Browsers only allow audio after a user gesture.
const unlock = () => { audio.unlock(); audio.startMusic(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).ctl = ctl;
