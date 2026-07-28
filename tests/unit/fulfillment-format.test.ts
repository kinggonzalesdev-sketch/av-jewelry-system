import { describe, expect, it } from 'vitest';

import { channelLabel } from '@/lib/fulfillment/format';

describe('channelLabel', () => {
  it('labels the known collection channels', () => {
    expect(channelLabel('rider')).toBe('Own Rider');
    expect(channelLabel('lbc')).toBe('LBC');
  });

  it('shows an em dash for an unset or unknown channel', () => {
    expect(channelLabel(null)).toBe('—');
    expect(channelLabel(undefined)).toBe('—');
    expect(channelLabel('grab')).toBe('—');
  });
});
