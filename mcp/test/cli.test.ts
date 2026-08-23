import { describe, it, expect } from 'vitest';
import { EXIT, parseArgs } from '../src/cli/index.js';

/**
 * The exit contract is the CLI's API — a pre-push hook and CI both read it, and
 * neither reads the prose. So it is pinned here, along with the argument
 * parsing that decides which code you get.
 */

describe('devdigest review — argument parsing', () => {
  it('defaults to --mode working', () => {
    expect(parseArgs([])).toEqual({ mode: 'working', all: false });
  });

  it('accepts --agent and --all', () => {
    expect(parseArgs(['--agent', 'Security Reviewer'])).toEqual({
      mode: 'working',
      agent: 'Security Reviewer',
      all: false,
    });
    expect(parseArgs(['--all'])).toEqual({ mode: 'working', all: true });
  });

  it('returns help for -h and --help', () => {
    expect(parseArgs(['-h'])).toBe('help');
    expect(parseArgs(['--help'])).toBe('help');
  });

  it('rejects an unknown mode, naming the valid ones', () => {
    expect(() => parseArgs(['--mode', 'nonsense'])).toThrow(/working, staged, branch/);
  });

  it('parses the unimplemented modes rather than pretending they do not exist', () => {
    // The architecture leaves room for them; `main` is what refuses. Silently
    // treating `--mode staged` as `working` would review the wrong thing.
    expect(parseArgs(['--mode', 'staged'])).toEqual({ mode: 'staged', all: false });
    expect(parseArgs(['--mode', 'branch'])).toEqual({ mode: 'branch', all: false });
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    expect(() => parseArgs(['--oops'])).toThrow(/Unknown argument/);
  });

  it('requires a value for --agent', () => {
    expect(() => parseArgs(['--agent'])).toThrow(/needs a name/);
  });
});

describe('devdigest review — the exit contract', () => {
  it('is 0 / 1 / 2, and nothing else', () => {
    expect(EXIT).toEqual({ CLEAN: 0, BLOCKED: 1, ERROR: 2 });
  });
});
