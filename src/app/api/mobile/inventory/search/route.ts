import { NextResponse } from 'next/server';

import { searchActiveInventory } from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/inventory/search?q=... — Active Inventory search for the Capture
 * app's item picker. RLS-scoped to the caller; returns only available items. The
 * screenshot is never the source of truth — the operator selects a real item here.
 */
export async function GET(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Session invalid or expired.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const items = await searchActiveInventory(staff.supabase, q);
  return NextResponse.json({ ok: true, items });
}
