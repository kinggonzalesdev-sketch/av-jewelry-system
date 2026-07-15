import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page does not exist, or it has not been built yet.
        </p>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: 'outline', className: 'mt-5 w-full' })}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
