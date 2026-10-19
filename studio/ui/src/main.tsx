import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadFeatureRegistrations } from './features/registrations';
import './styles.css';

// Registra editores de camada e paineis de cada feature (src/features/<feature>/register.ts)
// antes do primeiro render.
loadFeatureRegistrations()
  .catch((err) => console.error('Falha ao carregar registros de features', err))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
