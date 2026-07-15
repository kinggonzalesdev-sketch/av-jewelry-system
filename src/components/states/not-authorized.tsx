/**
 * Not-authorized state (Bible §5.13, §11.45).
 *
 * Displaying this is a CONSEQUENCE of a server-side denial — never the mechanism
 * of one. Reaching this screen means the trusted boundary already refused the
 * action and changed no record.
 *
 * It deliberately does not reveal what the record contains or which permission was
 * missing: an unauthorized user should not learn about data or the permission
 * structure from a denial.
 */
export function NotAuthorized({
  title = 'Not authorized',
  description = 'You do not have permission to view this. If you believe this is a mistake, contact the Owner or an administrator.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-border px-6 py-12 text-center"
      data-testid="not-authorized"
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      <p className="mt-3 text-xs text-muted-foreground">No record was changed.</p>
    </div>
  );
}
