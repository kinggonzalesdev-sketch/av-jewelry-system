import { describe, expect, it } from 'vitest';

import {
  captureAppLabel,
  printerStatusLabel,
  type CaptureDeviceStatus,
} from '@/lib/live/capture-device-format';

const base: CaptureDeviceStatus = {
  lastSeenAt: null,
  appVersionName: null,
  appVersionCode: null,
  buildCommit: null,
  printerConfigured: null,
  printerEnabled: null,
  printerConnectionState: null,
  printerName: null,
};

describe('captureAppLabel', () => {
  it('formats version + build code + commit', () => {
    expect(
      captureAppLabel({ ...base, appVersionName: '1.0.12', appVersionCode: 13, buildCommit: 'abc1234' }),
    ).toBe('1.0.12 (build 13 · abc1234)');
  });
  it('version name only', () => {
    expect(captureAppLabel({ ...base, appVersionName: '1.0.12' })).toBe('1.0.12');
  });
  it('em dash when unknown', () => {
    expect(captureAppLabel(null)).toBe('—');
    expect(captureAppLabel(base)).toBe('—');
  });
});

describe('printerStatusLabel', () => {
  it('distinguishes configured+OFF from configured+ON/connected', () => {
    expect(printerStatusLabel({ ...base, printerConfigured: true, printerEnabled: false })).toBe(
      'Configured · OFF',
    );
    expect(
      printerStatusLabel({
        ...base,
        printerConfigured: true,
        printerEnabled: true,
        printerConnectionState: 'connected',
      }),
    ).toBe('Configured · ON · connected');
  });
  it('not configured', () => {
    expect(printerStatusLabel({ ...base, printerConfigured: false })).toBe('Not configured');
  });
  it('em dash when unknown', () => {
    expect(printerStatusLabel(null)).toBe('—');
    expect(printerStatusLabel(base)).toBe('—');
  });
});
