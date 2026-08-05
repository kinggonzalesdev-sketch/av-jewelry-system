'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Small Facebook "f" badge in the order popup's summary — an HONEST link sign:
 *
 *   - Facebook-BLUE  = this customer IS linked (a Pancake conversation for Send
 *     Invoice, and/or a Messenger URL for Open FB Chat). Clicking opens the chat when
 *     a URL is saved.
 *   - Muted GREY     = NOT linked to Facebook yet, so the operator can see at a glance
 *     that Send Invoice will not reach the customer and that a chat must be linked.
 *
 * `linked` reflects a deliverable Pancake conversation; `url` is the openable Messenger
 * link. Either one counts as "linked" for the colour. `stopPropagation` keeps a click
 * from also triggering anything behind it.
 */
export function FbChatButton({
  url,
  linked = false,
  className,
}: {
  url: string | null | undefined;
  /** True when a Pancake conversation is linked (Send Invoice can deliver). */
  linked?: boolean;
  className?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const hasLink = Boolean(url) || linked;

  const show = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2600);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (linked) {
      show('Linked to a Pancake chat — no open-link saved. Add a Messenger link to open it.');
    } else {
      show('Not linked to Facebook yet.');
    }
  };

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        title={
          url
            ? 'Linked — open Facebook chat'
            : linked
              ? 'Linked to Pancake chat (no open-link saved)'
              : 'Not linked to Facebook yet'
        }
        data-testid="fb-chat-button"
        data-linked={hasLink ? 'true' : 'false'}
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none transition-opacity hover:opacity-90',
          hasLink ? 'bg-[#1877F2] text-white' : 'bg-muted text-muted-foreground',
          className,
        )}
      >
        <span aria-hidden="true">f</span>
        <span className="sr-only">{hasLink ? 'Linked to Facebook' : 'Not linked to Facebook'}</span>
      </button>
      {notice ? (
        <span
          role="status"
          className="absolute left-[26px] top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground shadow"
        >
          {notice}
        </span>
      ) : null}
    </span>
  );
}
