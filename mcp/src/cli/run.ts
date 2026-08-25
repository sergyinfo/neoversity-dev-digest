/** Thin runner: keeps `main` importable by tests without executing it. */
import { main } from './index.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`devdigest review crashed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);
