// Runs the API server (recompiled and restarted on change) and the Vite dev server together.
// Each child gets its own process group so teardown also reaches anything it spawned.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const apiPort = process.env.PORT ?? '4317', webPort = process.env.WEB_PORT ?? '5173';
const children = new Set();
let stopping = false;

function run(name, color, args, env = {}, onLine = () => {}) {
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1', ...env } });
  const prefix = `\x1b[${color}m${name.padEnd(4)}\x1b[0m│ `;
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', chunk => {
      const lines = (pending + chunk).split('\n'); pending = lines.pop();
      for (const line of lines) { process.stdout.write(prefix + line + '\n'); onLine(line); }
    });
  }
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) { console.log(`${prefix}exited (${signal ?? code}); stopping everything.`); stop(code || 1); }
    else if (!children.size) process.exit(process.exitCode ?? 0);
  });
  return child;
}

function signalAll(signal) { for (const child of children) try { process.kill(-child.pid, signal); } catch { /* already gone */ } }
function stop(code = 0) {
  if (stopping) return; stopping = true; process.exitCode = code;
  if (!children.size) process.exit(code);
  signalAll('SIGTERM');
  setTimeout(() => { signalAll('SIGKILL'); process.exit(code); }, 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(0));
process.on('exit', () => signalAll('SIGKILL'));

// Start the server only after the first compile, so it never boots from stale output.
let api;
run('tsc', '34', [require.resolve('typescript/lib/tsc.js'), '--watch', '--preserveWatchOutput', '--pretty'], {}, line => {
  if (!api && !stopping && /Found 0 errors/.test(line)) api = run('api', '32', ['--watch', '--disable-warning=ExperimentalWarning', 'dist/src/server.js'], { PORT: apiPort, DEV_WEB_URL: `http://127.0.0.1:${webPort}` });
});
console.log(`\nPR Guide (dev) → http://127.0.0.1:${webPort}\n`);
run('web', '35', ['node_modules/vite/bin/vite.js', '--port', webPort], { PORT: apiPort });
