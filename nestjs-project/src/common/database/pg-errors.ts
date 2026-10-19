import { QueryFailedError } from 'typeorm';

const PG_UNIQUE_VIOLATION = '23505';

/** True when `error` is a PostgreSQL unique violation on `column`. */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  // QueryFailedError copies the driver error fields (code, detail) onto itself
  const { code, detail } = error as QueryFailedError & {
    code?: string;
    detail?: unknown;
  };
  return (
    code === PG_UNIQUE_VIOLATION &&
    typeof detail === 'string' &&
    detail.includes(`(${column})`)
  );
}
