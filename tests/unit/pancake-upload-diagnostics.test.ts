import { describe, expect, it } from 'vitest';

import { summarizeUploadResponse } from '@/lib/integrations/pancake';

/**
 * Photo-pipeline instrumentation locks (Owner Controlled Photo Test B, 2026-08-18).
 * `summarizeUploadResponse` must preserve the FULL semantic distinction so ONE controlled
 * retry can separate an upload-staging failure from a send/attachment failure:
 *   - HTTP 200 alone is NEVER treated as upload success.
 *   - UPLOAD_HTTP_OK, UPLOAD_SUCCESS, UPLOAD_CONTENT_ID_PRESENT, UPLOAD_TYPE stay independent.
 *   - It NEVER leaks the token and NEVER exposes the full content id (last-6 suffix only).
 */

const ENDPOINT = 'https://pages.fm/api/public_api/v1/pages/{page_id}/upload_contents';

describe('summarizeUploadResponse — sanitized upload_contents diagnostics', () => {
  it('HTTP 200 + success:true + id + type=PHOTO → fully valid, id masked to last 6', () => {
    const d = summarizeUploadResponse({
      endpoint: ENDPOINT,
      apiVersion: 'v1',
      httpStatus: 200,
      httpOk: true,
      body: { success: true, id: 'CONTENT_abcdef123456', type: 'PHOTO' },
    });
    expect(d.httpOk).toBe(true);
    expect(d.success).toBe(true);
    expect(d.contentIdPresent).toBe(true);
    expect(d.contentIdSuffix).toBe('…123456');
    expect(d.type).toBe('PHOTO');
    expect(d.messageCode).toBeNull();
  });

  it('HTTP 200 + success:false + message_code → NOT success (200 alone is not success)', () => {
    const d = summarizeUploadResponse({
      endpoint: ENDPOINT,
      apiVersion: 'v1',
      httpStatus: 200,
      httpOk: true,
      body: { success: false, message_code: 'invalid_upload_fb_attachments_result' },
    });
    expect(d.httpOk).toBe(true); // transport ok…
    expect(d.success).toBe(false); // …but NOT upload success
    expect(d.contentIdPresent).toBe(false);
    expect(d.type).toBeNull();
    expect(d.messageCode).toBe('invalid_upload_fb_attachments_result');
  });

  it('id present but success:false keeps the two flags independent', () => {
    const d = summarizeUploadResponse({
      endpoint: ENDPOINT,
      apiVersion: 'v1',
      httpStatus: 200,
      httpOk: true,
      body: { success: false, id: 'X_998877', type: 'PHOTO' },
    });
    expect(d.success).toBe(false);
    expect(d.contentIdPresent).toBe(true);
    expect(d.contentIdSuffix).toBe('…998877');
  });

  it('non-2xx / unparseable body → all-false, no throw, version preserved', () => {
    const d = summarizeUploadResponse({
      endpoint: ENDPOINT,
      apiVersion: 'v2',
      httpStatus: 500,
      httpOk: false,
      body: null,
    });
    expect(d.httpOk).toBe(false);
    expect(d.success).toBe(false);
    expect(d.contentIdPresent).toBe(false);
    expect(d.contentIdSuffix).toBeNull();
    expect(d.type).toBeNull();
    expect(d.apiVersion).toBe('v2');
  });

  it('never leaks a token and never exposes the full content id', () => {
    const d = summarizeUploadResponse({
      endpoint: ENDPOINT,
      apiVersion: 'v1',
      httpStatus: 200,
      httpOk: true,
      body: { success: true, id: 'CONTENT_abcdef123456', type: 'PHOTO' },
    });
    expect(d.endpoint).toContain('{page_id}');
    expect(d.endpoint.toLowerCase()).not.toContain('token');
    expect(d.contentIdSuffix).not.toContain('abcdef');
  });
});
