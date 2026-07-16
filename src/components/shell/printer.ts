/**
 * Bluetooth / printer status — HONEST states only.
 *
 * The XP-236B Bluetooth printer (Bible §27.18) is a gated capability: it is only
 * usable after a REAL device passes validation at /admin/capabilities. Until then
 * the shell must never imply a working printer. In particular it must NEVER show
 * "Printer Ready" or a connected state without a recorded real-device validation.
 *
 * The five honest states, from least to most capable:
 *   - Browser Preview Available   — not a secure context (dev/preview over http);
 *                                   Web Bluetooth cannot run here at all.
 *   - Bluetooth Unsupported       — the browser has no Web Bluetooth API.
 *   - Bluetooth Not Connected     — Web Bluetooth exists but no device is paired.
 *   - Bluetooth Validation Required — a device could be used, but the printer
 *                                   capability has not passed real-device
 *                                   validation, so it is not enabled.
 *   - Printer Ready               — ONLY after a recorded real-device validation.
 */
export type PrinterState =
  | 'Browser Preview Available'
  | 'Bluetooth Unsupported'
  | 'Bluetooth Not Connected'
  | 'Bluetooth Validation Required'
  | 'Printer Ready';

export type PrinterEnv = {
  /** window.isSecureContext — Web Bluetooth requires a secure context. */
  readonly secureContext: boolean;
  /** 'bluetooth' in navigator. */
  readonly hasBluetooth: boolean;
  /** A device is currently paired/connected. */
  readonly deviceConnected: boolean;
  /** A real-device validation has been recorded for the printer capability. */
  readonly validated: boolean;
};

/**
 * Derive the honest state. "Printer Ready" is reachable ONLY when a real device
 * is connected AND a validation has been recorded — never fabricated.
 */
export function derivePrinterState(env: PrinterEnv): PrinterState {
  if (!env.secureContext) return 'Browser Preview Available';
  if (!env.hasBluetooth) return 'Bluetooth Unsupported';
  if (!env.deviceConnected) return 'Bluetooth Not Connected';
  if (!env.validated) return 'Bluetooth Validation Required';
  return 'Printer Ready';
}

export const PRINTER_TONE: Record<PrinterState, 'gold' | 'muted' | 'destructive'> = {
  'Browser Preview Available': 'muted',
  'Bluetooth Unsupported': 'muted',
  'Bluetooth Not Connected': 'muted',
  'Bluetooth Validation Required': 'gold',
  'Printer Ready': 'gold',
};
