/**
 * The only place in the controls that writes to the browser console (eslint enforces it).
 *
 * Privacy: a code and the kind of error, never a value, a record id, a name or a message that
 * could contain one. Console output in model-driven apps can end up in support tickets and
 * screenshots; treat it like a log that leaves the environment.
 */
export function reportError(code: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.warn(`[${code}] ${kind}`);
}
