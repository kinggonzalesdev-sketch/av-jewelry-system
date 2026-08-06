import 'server-only';

import { isPrimarySuperAdmin, requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getPancakeLinkStatus,
  getSelectedPancakePage,
  listPancakePages,
} from '@/lib/integrations/pancake';
import type {
  SystemCheckItem,
  SystemCheckResult,
} from '@/lib/live/system-check-types';

/**
 * Pre-Live System Check (Owner request). ONE read-only sweep the Super Admin runs
 * before a live: it proves the connections a live depends on and surfaces problems
 * early. It touches NO production data and creates nothing — every check is a read.
 *
 * The server covers what only the server can see (database, Pancake API, inventory,
 * message access, failed-job backlog, build version). The client panel adds the
 * device-local checks it alone can observe (internet, Realtime socket, Web
 * Bluetooth, floating app, paper) and merges them into the same list. Types live in
 * ./system-check-types so the client can import them without this server module.
 */

/** Compact "x ago" for a heartbeat age in ms. */
function relTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} day(s) ago`;
}

export async function runSystemCheck(): Promise<SystemCheckResult> {
  const staff = await requireActiveStaff();
  // Super Admin (owner) only — the whole live-readiness surface is Super-Admin gated.
  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Super Admin can run the system check.' };
  }

  const supabase = await createClient();
  const items: SystemCheckItem[] = [];

  // 1. Supabase database — a trivial head count proves the connection + RLS path.
  try {
    const { error } = await supabase
      .from('permissions')
      .select('key', { count: 'exact', head: true });
    items.push({
      key: 'database',
      label: 'Supabase Database',
      status: error ? 'failed' : 'ready',
      detail: error ? 'Database query failed.' : 'Connected.',
    });
  } catch {
    items.push({
      key: 'database',
      label: 'Supabase Database',
      status: 'failed',
      detail: 'Database unreachable.',
    });
  }

  // 2. Inventory access — the picker source must be readable and populated.
  try {
    const { count, error } = await supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('is_archived', false)
      .in('availability_status', ['available', 'returned_to_available']);
    items.push({
      key: 'inventory',
      label: 'Inventory Access',
      status: error ? 'failed' : (count ?? 0) > 0 ? 'ready' : 'warning',
      detail: error
        ? 'No inventory access.'
        : `${count ?? 0} available item(s).`,
    });
  } catch {
    items.push({
      key: 'inventory',
      label: 'Inventory Access',
      status: 'failed',
      detail: 'No inventory access.',
    });
  }

  // 3-5. Pancake connection + selected Page + conversation links. listPancakePages
  //      is Primary-Super-Admin gated (it hits pages.fm), so a second Super Admin
  //      sees an honest "Primary only" note rather than a hard failure.
  const primary = await isPrimarySuperAdmin();
  if (primary) {
    const pages = await listPancakePages();
    items.push({
      key: 'pancake',
      label: 'Pancake Connection',
      status:
        pages.code === 'loaded'
          ? 'ready'
          : pages.code === 'token_missing'
            ? 'not_configured'
            : pages.code === 'none_found'
              ? 'warning'
              : 'failed',
      detail: pages.message,
    });

    const selected = await getSelectedPancakePage();
    items.push({
      key: 'facebook_page',
      label: 'Facebook Page',
      status: selected ? 'ready' : 'not_configured',
      detail: selected
        ? `Selected: ${selected.pageName ?? selected.pageId}`
        : 'No Page selected yet.',
    });

    const link = await getPancakeLinkStatus();
    items.push({
      key: 'conversations',
      label: 'Customer & Conversation Lookup',
      status: link.linked > 0 ? 'ready' : 'warning',
      detail: `${link.linked}/${link.total} customer(s) linked to a conversation.`,
    });
  } else {
    items.push({
      key: 'pancake',
      label: 'Pancake Connection',
      status: 'not_configured',
      detail: 'Only the Primary Super Admin can test the Pancake connection.',
    });
  }

  // 6. Invoice messaging access — the Super Admin holds message_sending implicitly.
  items.push({
    key: 'messaging',
    label: 'Invoice Messaging Access',
    status: 'ready',
    detail: 'You can send invoices and reminders.',
  });

  // 7. Failed-job backlog — anything already Failed should be cleared before a live.
  try {
    const [msg, cap] = await Promise.all([
      supabase
        .from('customer_messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabase
        .from('capture_records')
        .select('id', { count: 'exact', head: true })
        .or('message_status.eq.failed,print_status.eq.failed'),
    ]);
    const failed = (msg.count ?? 0) + (cap.count ?? 0);
    items.push({
      key: 'failed_jobs',
      label: 'Pending Failed Jobs',
      status: failed > 0 ? 'warning' : 'ready',
      detail:
        failed > 0
          ? `${failed} failed job(s) to review/retry first.`
          : 'No failed jobs.',
    });
  } catch {
    items.push({
      key: 'failed_jobs',
      label: 'Pending Failed Jobs',
      status: 'warning',
      detail: 'Could not read job status.',
    });
  }

  // 8. Build version — proves every device is on the same deployment.
  const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local';
  items.push({
    key: 'version',
    label: 'Application Version',
    status: 'ready',
    detail: version,
  });

  // 9. Active printer device — from the printer registry. Ready once at least one
  //    printer is registered (the operator pairs it on the capture device); the
  //    default printer is named.
  try {
    const { data: printers } = await supabase
      .from('printers')
      .select('name, is_default')
      .eq('is_active', true);
    const list = (printers ?? []) as Array<{ name: string; is_default: boolean }>;
    if (list.length > 0) {
      const def = list.find((p) => p.is_default) ?? list[0];
      items.push({
        key: 'printer_device',
        label: 'Active Printer Device',
        status: 'ready',
        detail: `${list.length} printer(s) registered${def ? ` — default: ${def.name}` : ''}.`,
      });
    } else {
      items.push({
        key: 'printer_device',
        label: 'Active Printer Device',
        status: 'not_configured',
        detail: 'No printer registered yet — add one in Live Operations → Printers.',
      });
    }
  } catch {
    items.push({
      key: 'printer_device',
      label: 'Active Printer Device',
      status: 'not_configured',
      detail: 'Could not read the printer registry.',
    });
  }

  // 10 + 11. Capture device + floating app — reflect a REAL mobile sign-in via the
  //    heartbeat recorded on every mobile API call (the phone's login included).
  //    Ready when a capture account signed in within the last 24h.
  try {
    const { data: hb } = await supabase
      .from('capture_device_heartbeats')
      .select('last_seen_at')
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const seenAt = (hb as { last_seen_at?: string } | null)?.last_seen_at ?? null;
    const ageMs = seenAt ? Date.now() - new Date(seenAt).getTime() : null;
    const recent = ageMs !== null && ageMs <= 24 * 60 * 60 * 1000;
    const rel = ageMs !== null ? relTime(ageMs) : null;
    items.push({
      key: 'screenshot_device',
      label: 'Registered Screenshot Device',
      status: recent ? 'ready' : 'not_configured',
      detail: recent
        ? `A capture device is signed in — last active ${rel}.`
        : 'No capture device signed in yet — sign in on the MineFlow Capture app on the phone.',
    });
    items.push({
      key: 'floating_app',
      label: 'Floating Screenshot App',
      status: recent ? 'ready' : 'not_configured',
      detail: recent
        ? `Capture app signed in (active ${rel}) — make sure the floating button is running on the phone.`
        : 'Open MineFlow Capture on the phone and start the floating button.',
    });
  } catch {
    items.push({
      key: 'screenshot_device',
      label: 'Registered Screenshot Device',
      status: 'not_configured',
      detail: 'Could not read capture-device status.',
    });
    items.push({
      key: 'floating_app',
      label: 'Floating Screenshot App',
      status: 'not_configured',
      detail: 'Confirmed on the Android capture device.',
    });
  }

  return { ok: true, items };
}
