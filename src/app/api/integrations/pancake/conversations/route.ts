import { NextResponse } from 'next/server';

import { listPancakeConversations } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';
// The paced, multi-window Pancake fetch (with 429 backoff) can take a while.
export const maxDuration = 60;

/**
 * GET /api/integrations/pancake/conversations — the selected Page's conversations
 * (id + FB name + last message), so the Primary Super Admin can grab a conversation
 * ID for a test send. Server-side only; the token never reaches the browser.
 */
export async function GET(): Promise<Response> {
  const result = await listPancakeConversations();
  const status =
    result.code === 'forbidden'
      ? 403
      : result.code === 'token_invalid'
        ? 401
        : result.code === 'permission_denied'
          ? 403
          : result.code === 'token_missing'
            ? 503
            : result.ok
              ? 200
              : 502;
  return NextResponse.json(
    {
      ok: result.ok,
      code: result.code,
      message: result.message,
      conversations: result.conversations,
      debug: result.debug ?? null,
    },
    { status },
  );
}
