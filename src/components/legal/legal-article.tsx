import type { ReactNode } from 'react';

import { LEGAL_EFFECTIVE_DATE, LEGAL_EFFECTIVE_DATE_ISO } from '@/lib/legal/legal-info';

/**
 * Consistent typography + the Effective Date for every legal page. The wrapper styles all
 * descendant h2/h3/p/ul/a/strong so the pages themselves stay clean semantic HTML (good for screen
 * readers). The Effective Date comes from ONE shared constant (src/lib/legal/legal-info.ts) so all
 * four pages always show the same date. Items still awaiting Owner confirmation and the
 * recommended legal review are tracked for developers in docs/LEGAL-PAGES-CHECKLIST.md, not shown
 * to customers.
 */
export function LegalArticle({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="break-words [&_a]:text-gold-strong [&_a]:underline [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:leading-relaxed [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ol]:text-sm [&_ol]:text-muted-foreground [&_p]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-sm [&_ul]:text-muted-foreground">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p
        className="mt-1 text-xs text-muted-foreground"
        data-testid="legal-effective-date"
      >
        Effective Date:{' '}
        <time dateTime={LEGAL_EFFECTIVE_DATE_ISO}>{LEGAL_EFFECTIVE_DATE}</time>
      </p>
      {children}
    </article>
  );
}
