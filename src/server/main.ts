import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildApp } from './app.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.PORT ?? '4310' },
    'data-dir': { type: 'string', default: process.env.WORKBENCH_DATA_DIR ?? './data' },
    'local-dir': { type: 'string', default: process.env.WORKBENCH_LOCAL_DIR ?? './.local' },
  },
  strict: true,
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1—65535');
const instance = await buildApp({
  dataDir: resolve(values['data-dir']!),
  localDir: resolve(values['local-dir']!),
  staticDir: resolve('dist'),
});
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await instance.app.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
try {
  await instance.app.listen({ port, host: '127.0.0.1' });
  console.log(`个人专注工作台 v0.3.0 · http://127.0.0.1:${port}`);
  console.log(`数据目录：${resolve(values['data-dir']!)}`);
} catch (error) {
  console.error(
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用。请用 npm start -- --port <其他端口>，或关闭占用服务。`
      : (error as Error).message,
  );
  await instance.app.close();
  process.exitCode = 1;
}
