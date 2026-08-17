import { describe, expect, it } from 'vitest';

import { buildPrivateReplyBody, extractPageUsers } from '@/lib/integrations/pancake';

/**
 * Pancake Private Reply — verified official contract locks (Owner PDF, 2026-08-17).
 * The private_replies body MUST be exactly action + post_id + message_id + from_id +
 * sender_id + message — TEXT only (no content_ids, no attachment_type, no
 * conversation_id in the body). Get Users must parse only the active `users[]` and
 * NEVER `disabled_users[]`.
 */

describe('buildPrivateReplyBody — the verified private_replies mapping', () => {
  const body = buildPrivateReplyBody({
    postId: 'POST_1',
    messageId: 'COMMENT_1',
    fromId: 'PSID_1',
    senderId: 'PANCAKE_USER_1',
    message: 'Hi! Here is the item you mined during our Live.',
  });

  it('uses the exact official action + fields', () => {
    expect(body).toEqual({
      action: 'private_replies',
      post_id: 'POST_1',
      message_id: 'COMMENT_1',
      from_id: 'PSID_1',
      sender_id: 'PANCAKE_USER_1',
      message: 'Hi! Here is the item you mined during our Live.',
    });
  });

  it('is TEXT-only — no photo/content fields, no conversation_id in the body', () => {
    expect(body).not.toHaveProperty('content_ids');
    expect(body).not.toHaveProperty('content_ids[]');
    expect(body).not.toHaveProperty('attachment_type');
    expect(body).not.toHaveProperty('conversation_id');
  });

  it('from_id = commenter PSID and sender_id = Pancake user (never page_id / swapped)', () => {
    expect(body.from_id).toBe('PSID_1');
    expect(body.sender_id).toBe('PANCAKE_USER_1');
    expect(body.action).toBe('private_replies');
  });
});

describe('extractPageUsers — only active users[], never disabled_users[]', () => {
  const parsed = extractPageUsers({
    success: true,
    users: [
      {
        id: 'u1',
        name: 'Alice',
        status: 'active',
        fb_id: 'fb1',
        page_permissions: [1, 2],
        status_in_page: 'admin',
        is_online: true,
      },
      { id: 'u2', name: 'Bob', status_in_page: 'staff', is_online: false },
      { name: 'No Id — dropped' },
    ],
    disabled_users: [{ id: 'disabled1', name: 'Should NOT appear' }],
    round_robin_users: { comment: [], inbox: [] },
  });

  it('returns only rows with an id, from users[] only', () => {
    expect(parsed.map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('never includes disabled_users', () => {
    expect(parsed.some((u) => u.id === 'disabled1')).toBe(false);
  });

  it('maps safe fields (status_in_page / is_online) and keeps page_permissions raw', () => {
    expect(parsed[0]).toMatchObject({
      id: 'u1',
      name: 'Alice',
      statusInPage: 'admin',
      isOnline: true,
      pagePermissions: [1, 2],
    });
    expect(parsed[1]).toMatchObject({ id: 'u2', isOnline: false, statusInPage: 'staff' });
  });

  it('tolerates a non-array / empty payload', () => {
    expect(extractPageUsers(null)).toEqual([]);
    expect(extractPageUsers({})).toEqual([]);
    expect(extractPageUsers({ users: 'nope' })).toEqual([]);
  });
});
