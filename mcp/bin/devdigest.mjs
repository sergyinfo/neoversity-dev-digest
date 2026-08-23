#!/usr/bin/env node
/**
 * `devdigest` entry point.
 *
 * The CLI is TypeScript, so this shim re-execs it through the local `tsx` and
 * FORWARDS THE CHILD'S EXIT CODE UNCHANGED — the exit code is the CLI's
 * contract with CI and with a pre-push hook, and swallowing it would make the
 * whole tool decorative.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tsx = join(here, '..', 'node_modules', '.bin', 'tsx');
const entry = join(here, '..', 'src', 'cli', 'run.ts');

const [, , command, ...rest] = process.argv;
if (command !== 'review') {
  process.stderr.write("usage: devdigest review [--mode working] [--agent <name>]\n");
  process.exit(2);
}

const child = spawn(tsx, [entry, ...rest], { stdio: 'inherit' });
child.on('error', (err) => {
  process.stderr.write(`devdigest: could not start (${err.message})\n`);
  process.exit(2);
});
child.on('exit', (code, signal) => process.exit(signal ? 2 : (code ?? 2)));
