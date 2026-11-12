import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, SpecIssue, SpecValidation } from '@local-app-studio/runtime/spec/schema';
import { CATALOG_CHECKS } from '@/catalog/validateLayout';

/** The one client-side definition of a valid spec: the schema plus the catalog layout checks. */
export function validateSpec(input: unknown): SpecValidation<AppSpec> {
  return validateAppSpec(input, { ...CATALOG_CHECKS });
}

const isAt = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}.`);

/** Issues at `prefix` or below it ("tables.0" matches "tables.0.fields.1.id" but not "tables.01"). */
export function issuesAt(issues: readonly SpecIssue[], prefix: string): SpecIssue[] {
  return issues.filter((i) => isAt(i.path, prefix));
}

/** Issues that are not at or below `prefix`. */
export function issuesOutside(issues: readonly SpecIssue[], prefix: string): SpecIssue[] {
  return issues.filter((i) => !isAt(i.path, prefix));
}
