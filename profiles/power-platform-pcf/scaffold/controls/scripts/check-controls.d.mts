// Types for the tests, which import the checks directly.
export interface CheckResult {
  errors: string[];
  warnings: string[];
  controls: number;
}
export function checkProject(root?: string, options?: { strict?: boolean; locales?: unknown }): CheckResult;
