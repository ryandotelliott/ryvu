import { spawn } from 'node:child_process';
import { UserError } from './domain.js';
export type CommandOptions = { signal: AbortSignal; cwd?: string; input?: string; timeoutMs?: number; maxBytes?: number; failureDetail?: (output: string) => string | undefined };
export type Runner = (command: string, args: string[], options: CommandOptions) => Promise<string>;
export const runCommand: Runner = (command, args, options) => new Promise((resolve, reject) => {
  options.signal.throwIfAborted();
  const child = spawn(command, args, { cwd: options.cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
  let output = '', size = 0, terminalError: Error | undefined;
  const stop = (error: Error) => {
    terminalError ??= error;
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid!, 'SIGTERM'); } catch { /* already exited */ }
    killTimer ??= setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid!, 'SIGKILL'); } catch { /* already exited */ } }, 800);
    killTimer.unref();
  };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => stop(new DOMException('Cancelled', 'AbortError'));
  const timer = setTimeout(() => stop(new UserError(`${command} timed out. Try again or use a smaller PR.`)), options.timeoutMs ?? 30_000);
  options.signal.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > (options.maxBytes ?? 2_000_000)) stop(new UserError('Command output exceeded the safe size limit.')); else output += chunk.toString(); });
  // Drain stderr without returning raw CLI logs or account data to the browser.
  child.stderr.on('data', (chunk: Buffer) => { size += chunk.length; if (size > (options.maxBytes ?? 2_000_000)) stop(new UserError('Command output exceeded the safe size limit.')); });
  child.stdin.on('error', () => { /* exit/error event supplies the result */ });
  child.once('error', error => { terminalError = new UserError(`Could not start ${command}: ${'code' in error && error.code === 'ENOENT' ? 'not installed or not on PATH' : 'process unavailable'}.`); });
  child.once('close', code => {
    clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal.removeEventListener('abort', abort);
    if (terminalError) reject(terminalError);
    else if (options.signal.aborted) reject(new DOMException('Cancelled', 'AbortError'));
    else if (code !== 0) reject(new UserError(options.failureDetail?.(output) ?? `${command} exited unsuccessfully. Check its existing sign-in and account access in your terminal, then retry.`));
    else resolve(output);
  });
  child.stdin.end(options.input ?? '');
});
