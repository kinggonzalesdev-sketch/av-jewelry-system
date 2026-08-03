'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Small Facebook-blue "f" button used inside the order popup's summary. Clicking it
 * opens the customer's saved Messenger chat in a new tab; when no chat link is
 * stored yet it shows a brief inline notice instead of doing nothing, so the
 * operator knows to add one (via "Update Facebook chat"). `stopPropagation` keeps a
 * click from also triggering anything behind it.
 */
export function FbChatButton({
  url,
  className,
}: {
  url: string | null | undefined;
  className?: string;
}) {
  const [notice, setNotice] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setNotice(true);
      setTimeout(() => setNotice(false), 2600);
    }
  };

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        title={url ? 'Open Facebook chat' : 'No Facebook conversation linked yet'}
        data-testid="fb-chat-button"
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold leading-none text-white transition-opacity hover:opacity-90',
          className,
        )}
      >
        <span aria-hidden="true">f</span>
        <span className="sr-only">Open Facebook chat</span>
      </button>
      {notice ? (
        <span
          role="status"
          className="absolute left-[26px] top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground shadow"
        >
          No Facebook conversation linked yet.
        </span>
      ) : null}
    </span>
  );
}
