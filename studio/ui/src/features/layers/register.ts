import { registerLayerEditor } from '../editors/registry';
import { DomainEditor } from './DomainEditor';
import { RepositoryEditor } from './RepositoryEditor';
import { RotasEditor } from './RotasEditor';
import { WorkerEditor } from './WorkerEditor';
import { MigrationEditor } from './MigrationEditor';

registerLayerEditor('domain', DomainEditor);
registerLayerEditor('repository', RepositoryEditor);
registerLayerEditor('controller', RotasEditor);
registerLayerEditor('routes', RotasEditor);
registerLayerEditor('worker', WorkerEditor);
registerLayerEditor('migration', MigrationEditor);
