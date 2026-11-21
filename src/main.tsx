import { render } from 'preact';
import { App } from './ui/app';
import './ui/styles.css';

const root = document.getElementById('app');
if (root) render(<App />, root);

// The game owns the page: no context menu, no text selection, no accidental drag.
addEventListener('dragstart', (e) => e.preventDefault());
