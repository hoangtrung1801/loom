import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';

createRoot(document.getElementById('root')!).render(<App />);
