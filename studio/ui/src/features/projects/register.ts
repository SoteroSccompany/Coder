import { registerBottomPanel } from '../panels/registry';
import { CustomizePanel } from './CustomizePanel';

registerBottomPanel({
  id: 'personalizar',
  title: 'Personalizar',
  order: 15,
  component: CustomizePanel,
});
