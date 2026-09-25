import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdateOverlay } from './components/ui/UpdateOverlay';
import { registerAppUpdates } from './services/appUpdate';
import './index.css';

registerAppUpdates();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing');

createRoot(root).render(
  <StrictMode>
    <App />
    <UpdateOverlay />
  </StrictMode>,
);
