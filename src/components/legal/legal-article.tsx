import type { ReactNode } from 'react';

/**
 * Consistent typography + the mandatory "draft pending review" banner for every legal page. The
 * wrapper styles all descendant h2/h3/p/ul/a/strong so the pages themselves stay clean semantic
 * HTML (good for screen readers). Nothing here is legal advice — see the banner.
 */
export function LegalArticle({
  title,
  effectiveDate = '[OWNER INPUT REQUIRED — effective date]',
  children,
}: {
  title: string;
  effectiveDate?: string;
  children: ReactNode;
}) {
  return (
    <article className="[&_a]:text-gold-strong [&_a]:underline [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:leading-relaxed [&_p]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-sm [&_ul]:text-muted-foreground">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 text-xs text-muted-foreground">Effective date: {effectiveDate}</p>
      <div
        role="note"
        className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground"
      >
        <strong>Draft pending review.</strong> This document was prepared from the system&apos;s
        actual technical behavior. Items marked <strong>[OWNER INPUT REQUIRED]</strong> must be
        completed by the business owner, and the whole document should be reviewed by a Philippine
        lawyer before the website goes live. It is not legal advice.
      </div>
      {children}
    </article>
  );
}
