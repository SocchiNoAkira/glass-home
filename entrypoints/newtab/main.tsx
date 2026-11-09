import { createRoot } from 'react-dom/client';
import { App } from '@/src/features/home/App';
import '@/src/styles/global.css';
import '@/src/styles/stage-1.css';
import '@/src/styles/stage-2a.css';
import '@/src/styles/stage-2b-1.css';
import '@/src/styles/stage-3.css';
import '@/src/styles/stage-4.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(<App />);
