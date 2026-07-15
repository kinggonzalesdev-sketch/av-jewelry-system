/**
 * Generic loading state.
 *
 * Announced politely to assistive technology so a screen-reader user is told that
 * content is pending rather than absent.
 */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center px-6 py-12"
      role="status"
      aria-live="polite"
      data-testid="loading-state"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
