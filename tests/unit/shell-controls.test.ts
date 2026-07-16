import { describe, expect, it } from 'vitest';

import { derivePrinterState, type PrinterEnv } from '@/components/shell/printer';
import { effectiveTheme, otherTheme, parseTheme } from '@/components/shell/theme';

/**
 * Pure logic behind the restored global controls.
 */
describe('theme resolution', () => {
  it('treats only "light" / "dark" as a stored choice', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme('sepia')).toBeNull();
  });

  it('follows the OS preference when there is no stored choice', () => {
    expect(effectiveTheme(null, true)).toBe('dark');
    expect(effectiveTheme(null, false)).toBe('light');
  });

  it('lets a manual choice override the OS preference', () => {
    expect(effectiveTheme('light', true)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
  });

  it('flips to the other theme', () => {
    expect(otherTheme('light')).toBe('dark');
    expect(otherTheme('dark')).toBe('light');
  });
});

describe('honest Bluetooth/printer state', () => {
  const base: PrinterEnv = {
    secureContext: true,
    hasBluetooth: true,
    deviceConnected: false,
    validated: false,
  };

  it('reports Browser Preview Available outside a secure context', () => {
    expect(derivePrinterState({ ...base, secureContext: false })).toBe(
      'Browser Preview Available',
    );
  });

  it('reports Bluetooth Unsupported without the Web Bluetooth API', () => {
    expect(derivePrinterState({ ...base, hasBluetooth: false })).toBe(
      'Bluetooth Unsupported',
    );
  });

  it('reports Bluetooth Not Connected when supported but no device is paired', () => {
    expect(derivePrinterState(base)).toBe('Bluetooth Not Connected');
  });

  it('reports Bluetooth Validation Required when connected but not validated', () => {
    expect(derivePrinterState({ ...base, deviceConnected: true })).toBe(
      'Bluetooth Validation Required',
    );
  });

  it('reaches Printer Ready ONLY after a recorded real-device validation', () => {
    expect(derivePrinterState({ ...base, deviceConnected: true, validated: true })).toBe(
      'Printer Ready',
    );
    // Never ready without validation, no matter the connection state.
    expect(derivePrinterState({ ...base, deviceConnected: true })).not.toBe(
      'Printer Ready',
    );
  });
});
