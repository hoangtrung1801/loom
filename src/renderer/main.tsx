import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/base.css';
import './styles/shell.css';
import './styles/editor.css';
import './styles/board.css';
import './styles/chat.css';

createRoot(document.getElementById('root')!).render(<App />);
