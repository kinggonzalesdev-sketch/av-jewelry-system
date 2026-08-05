/** Shared type for the Live Operations → Recent Activity panel. Not server-only so
 *  the client panel can import it. Structurally matches dashboard AuditRow. */
export type ActivityRow = {
  id: string;
  occurredAt: string;
  actorLabel: string | null;
  action: string;
  entityType: string;
  outcome: string;
  reason: string | null;
};
