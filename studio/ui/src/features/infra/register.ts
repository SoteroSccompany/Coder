import { registerBottomPanel } from '../panels/registry';
import { OperacaoPanel } from './OperacaoPanel';

registerBottomPanel({ id: 'operacao', title: 'Operacao', order: 20, component: OperacaoPanel });
