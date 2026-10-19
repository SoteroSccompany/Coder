// Registra o canvas de blocos como editor da camada usecase.
// Carregado automaticamente por src/features/registrations.ts.

import { lazy } from 'react';
import { registerLayerEditor } from '../editors/registry';

const BlocksEditor = lazy(() => import('./BlocksEditor').then((m) => ({ default: m.BlocksEditor })));

registerLayerEditor('usecase', BlocksEditor);
