import { createApp } from './bootstrap.js';
import { Environment } from './services/environment.service.js';
import { LogService } from './services/log.service.js';

const app = await createApp();
const { PORT, NODE_ENV } = app.get(Environment).env;

await app.listen(PORT, '0.0.0.0');
app.get(LogService).info('api.listening', { port: PORT, env: NODE_ENV });
