/** Shared printer-registry types. Not server-only so the client panel can import. */

export type PrinterRow = {
  id: string;
  name: string;
  target: string | null;
  transport: string;
  labelSize: string | null;
  isActive: boolean;
  isDefault: boolean;
  lastSeenAt: string | null;
};

/** A snapshot of the print queue for the management panel. */
export type PrintQueueStatus = {
  pending: number;
  claimed: number;
  failed: number;
};

export type PrinterResult = { ok: true } | { ok: false; error: string };
