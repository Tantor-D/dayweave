import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { stdio: 'inherit' }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort'],
    { stdio: 'inherit' },
  ),
];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
children.forEach((child) => child.on('exit', (code) => stop(code ?? 0)));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
