// The app under test: used as it is when the base URL already answers, otherwise started with
// config app.start.command (and stopped again afterwards), waiting until readyPath answers.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from './config.mjs';
import { toolDir, sleep, log } from './util.mjs';

async function answers(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    return response.status < 500;
  } catch { return false; }
}

/** Runs `work(base)` with the app up; starts and stops it when needed (unless noStart). */
export async function withApp(work, { noStart = false } = {}) {
  const c = config();
  const base = c.app.base;
  const start = c.app.start;
  const ready = `${base}${start?.readyPath ?? '/'}`;
  if (await answers(ready)) return work(base);
  if (noStart || !start?.command) throw new Error(`${ready} does not answer. Start the app (or configure app.start.command).`);
  const command = start.command.replaceAll('{tool}', toolDir.replace(/\\/g, '/')).replaceAll('{base}', base);
  log(`starting the app: ${command}`);
  const child = spawn(command, {
    cwd: resolve(c.root, start.cwd ?? '.'), shell: true, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, ...(start.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (d) => { output = (output + d).slice(-4000); });
  child.stderr.on('data', (d) => { output = (output + d).slice(-4000); });
  const stop = () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  };
  try {
    const deadline = Date.now() + (start.timeoutSeconds ?? 120) * 1000;
    while (!(await answers(ready))) {
      if (child.exitCode !== null) throw new Error(`The app's start command exited (${child.exitCode}):\n${output}`);
      if (Date.now() > deadline) throw new Error(`The app did not answer at ${ready} within ${start.timeoutSeconds ?? 120} s:\n${output}`);
      await sleep(500);
    }
    log(`app up at ${base}`);
    return await work(base);
  } finally {
    stop();
  }
}
