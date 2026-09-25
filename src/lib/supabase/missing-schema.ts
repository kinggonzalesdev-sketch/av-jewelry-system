/**
 * Is this error "the migration is not applied yet"? New code that calls a new database function or
 * reads a new column must keep working on a database that does not have it yet (a web deploy and a
 * migration are approved and applied separately), so callers fall back to the old path ONLY for
 * these errors — never for a business error, which must still reach the user.
 */

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * The called function does not exist — PostgREST's schema-cache miss. Deliberately NOT Postgres's
 * 42883: that can also be raised INSIDE a function that does exist, and must then surface as an
 * error, not silently switch to the old path.
 */
export function isMissingFunction(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
  );
}

/** A selected column does not exist (Postgres undefined_column, or PostgREST's schema cache). */
export function isMissingColumn(error: DbError): boolean {
  if (!error) return false;
  return ['42703', 'PGRST204'].includes(error.code ?? '');
}
