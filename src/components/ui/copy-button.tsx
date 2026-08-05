'use client';

import { useState } from 'react';

/**
 * Copy text to the clipboard with brief inline feedback. Self-contained (its own
 * state) so it can drop into any panel without threading state through the parent.
 */
export function CopyButton({
  text,
  label = 'Copy',
  className,
  testId,
}: {
  text: string;
  label?: string;
  className?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions / insecure context) — no-op, never throws.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={!text.trim()}
      data-testid={testId}
      className={className}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
