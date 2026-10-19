import { registerBottomPanel } from '../panels/registry';
import { LogsPanel } from './LogsPanel';

registerBottomPanel({ id: 'logs', title: 'Logs', order: 0, component: LogsPanel });
