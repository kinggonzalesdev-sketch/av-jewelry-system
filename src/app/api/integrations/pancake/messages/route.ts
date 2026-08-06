import { NextResponse } from 'next/server';

import { getPancakeConversationMessages } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/integrations/pancake/messages?conversationId=… — recent messages of one
 * Pancake conversation, so the operator can eyeball the chat before sending. Super
 * Admin only (enforced in the domain function); the token never reaches the browser.
 */
export async function GET(request: Request): Promise<Response> {
  const conversationId = new URL(request.url).searchParams.get('conversationId') ?? '';
  const result = await getPancakeConversationMessages(conversationId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
