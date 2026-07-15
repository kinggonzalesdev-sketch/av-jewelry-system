import { redirect } from 'next/navigation';

/**
 * Landing page.
 *
 * For Owner prototype review the landing page is **Dashboard Report**.
 *
 * The approved rule for PRODUCTION (Phase 3+), not implemented here:
 *   - Owner and users with Dashboard / Reports access → Dashboard Report;
 *   - users without Dashboard access → Orders, or their first authorized page;
 *   - otherwise → Not Authorized.
 *
 * The prototype has no permissions, so it always lands on Dashboard Report.
 * UI visibility is not authority: production must resolve the landing page from
 * the caller's real grants, server-side.
 */
export default function PreviewIndexPage() {
  redirect('/preview/dashboard-report');
}
