import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { MessageTemplatesPanel } from '@/components/settings/message-templates-panel';
import { PageHeader } from '@/components/ui/page-primitives';
import { canOpenPage, isPrimarySuperAdmin, requireActiveStaff } from '@/lib/authz/guard';
import { listMessageTemplates } from '@/lib/messaging/templates';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Settings → Message Templates. SUPER ADMIN only.
 *
 * Enforced HERE, not just by hiding the Settings card: an Admin who types this URL
 * gets nothing. The reader is Super-Admin gated too, and the save/reset database
 * functions refuse anyone else — three layers, because the raw wording is the thing
 * Admins may use but not change.
 */
export default async function MessageTemplatesPage() {
  const staff = await requireActiveStaff();
  if (!(await canOpenPage('view_settings'))) notFound();
  // Super Admin = the owner role. An Admin never reaches the raw templates.
  if (staff.roleKey !== 'owner') notFound();
  // Referenced so the primary check stays available for future primary-only bits.
  await isPrimarySuperAdmin();

  const templates = await listMessageTemplates();

  return (
    <div className="space-y-4">
      <PageHeader title="Message Templates" />
      <Link
        href="/settings"
        className="inline-block text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        ← Back to Settings
      </Link>
      <MessageTemplatesPanel templates={templates} />
    </div>
  );
}
