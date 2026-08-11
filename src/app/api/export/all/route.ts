import { NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { buildDataExport } from '@/lib/export/data-export';
import { ALL_EXPORT_SECTION_KEYS, type ExportSectionKey } from '@/lib/export/sections';

export const dynamic = 'force-dynamic';

/**
 * Full-data export (Owner/Admin). Server-side generation of ONE Excel workbook —
 * the browser never loads the dataset; it only downloads the finished file. RBAC
 * is enforced here AND in the sales RPC. Read-only: nothing is written or deleted.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return NextResponse.json({ error: cause.message }, { status: 403 });
    }
    throw cause;
  }

  let body: {
    from?: string | null;
    to?: string | null;
    applyRange?: boolean;
    sections?: string[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const requested = Array.isArray(body.sections)
    ? body.sections
    : ALL_EXPORT_SECTION_KEYS;
  const sections = requested.filter((s): s is ExportSectionKey =>
    (ALL_EXPORT_SECTION_KEYS as string[]).includes(s),
  );
  const finalSections = sections.length > 0 ? sections : ALL_EXPORT_SECTION_KEYS;

  const isDate = (v: unknown): v is string =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(body.from) ? body.from : null;
  const to = isDate(body.to) ? body.to : null;
  const applyRange = body.applyRange === true && Boolean(from && to);

  try {
    const buffer = await buildDataExport({
      from,
      to,
      applyRange,
      sections: finalSections,
    });

    await recordAuditEvent({
      action: 'data.export_all',
      entityType: 'data_export',
      context: {
        sections: finalSections,
        applied_range: applyRange,
        from: applyRange ? from : null,
        to: applyRange ? to : null,
        bytes: buffer.length,
      },
    });

    const fileName = `MineFlow-Data-Export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (cause) {
    await recordAuditEvent({
      action: 'data.export_all',
      entityType: 'data_export',
      outcome: 'failed',
      reason: cause instanceof Error ? cause.message : 'export failed',
    });
    return NextResponse.json(
      { error: 'The export could not be generated. Please try again.' },
      { status: 500 },
    );
  }
}
