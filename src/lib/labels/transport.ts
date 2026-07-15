import 'server-only';

/**
 * Label transport (Bible §24, §27).
 *
 * ⚠️  REAL BLUETOOTH PRINTING IS NOT IMPLEMENTED AND NOT VERIFIED.
 *
 * The approved target is an Xprinter XP-236B over Bluetooth, 40 × 30 mm. That
 * device has never been tested against this system (§27), so this module makes
 * no claim about it. `bluetooth` is a declared-but-unsupported transport: asking
 * for it returns `unsupported`, honestly, rather than pretending to queue a job.
 *
 * RENDERING IS SEPARATE FROM TRANSPORT, deliberately:
 *   - renderLabel()  — turns a label job into printable content. Pure. Testable
 *                      without a device. This is real and final-ish.
 *   - send()         — hands content to a device. Currently mock/preview only.
 *
 * Keeping them apart means the day a real XP-236B driver arrives, only `send()`
 * changes, and nothing about what gets printed has to be re-approved.
 *
 * A mock result must NEVER be recorded as a real print — every attempt records
 * which transport produced it, so a demo can never masquerade as a shipment.
 */

export type TransportKind = 'mock' | 'browser_preview' | 'bluetooth';

export type TransportOutcome =
  | { status: 'printed'; transport: TransportKind }
  | { status: 'failed'; transport: TransportKind; reason: string }
  | { status: 'unsupported'; transport: TransportKind; reason: string };

export type LabelContent = {
  /** 40 × 30 mm at 203 dpi ≈ 320 × 240 dots. Recorded for the future driver. */
  widthDots: number;
  heightDots: number;
  lines: string[];
};

export type LabelJobPayload = {
  claimReference: string;
  customerDisplayName: string | null;
  itemCode: string | null;
  itemName: string | null;
  gramsPerPiece: number | null;
  quantity: number | null;
  totalPrice: number | null;
  labelSize: string;
};

/**
 * Renders a label job into printable content.
 *
 * Pure and device-free: this is what a label SAYS, not how it reaches paper.
 * PROVISIONAL (§24.17) — the exact printed field set is not client-final.
 */
export function renderLabel(payload: LabelJobPayload): LabelContent {
  const lines = [
    payload.claimReference,
    payload.customerDisplayName ?? '—',
    [payload.itemCode, payload.itemName].filter(Boolean).join(' · ') || '—',
    payload.gramsPerPiece !== null ? `${payload.gramsPerPiece}g/pc` : '',
    payload.quantity !== null ? `Qty ${payload.quantity}` : '',
    payload.totalPrice !== null ? `PHP ${payload.totalPrice.toFixed(2)}` : '',
  ].filter((line) => line.length > 0);

  return { widthDots: 320, heightDots: 240, lines };
}

/**
 * Hands rendered content to a transport.
 *
 * `bluetooth` returns `unsupported` — not `failed`. The distinction matters:
 * "failed" invites a retry that can never succeed, while "unsupported" tells the
 * truth, which is that the integration does not exist yet.
 */
export function send(
  transport: TransportKind,
  content: LabelContent,
): Promise<TransportOutcome> {
  // Returns a promise without awaiting: nothing here talks to a device YET, so
  // there is genuinely nothing to wait for. The async CONTRACT is kept because a
  // real driver will be I/O-bound, and every caller already awaits it — so the
  // day Bluetooth lands, no call site changes.
  switch (transport) {
    case 'bluetooth':
      return Promise.resolve({
        status: 'unsupported',
        transport,
        reason:
          'Bluetooth printing to the Xprinter XP-236B is not implemented and not verified. Use the browser preview and print manually.',
      });

    case 'browser_preview':
      // Real and useful: the operator gets the label and prints it themselves.
      // Honest because the human, not this code, performs the physical print.
      return Promise.resolve(
        content.lines.length > 0
          ? { status: 'printed', transport }
          : { status: 'failed', transport, reason: 'The label rendered empty.' },
      );

    case 'mock':
      return Promise.resolve({ status: 'printed', transport });

    default:
      return Promise.resolve({
        status: 'unsupported',
        transport,
        reason: `Unknown transport: ${String(transport)}`,
      });
  }
}
