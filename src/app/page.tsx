import { redirect } from 'next/navigation';

/**
 * The application has no public landing page — it is an internal staff tool.
 * Unauthenticated visitors are redirected onward to sign-in by middleware.
 */
export default function RootPage() {
  redirect('/dashboard');
}
