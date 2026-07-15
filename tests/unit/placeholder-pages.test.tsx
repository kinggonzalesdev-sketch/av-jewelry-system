import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from '@/components/states/empty-state';
import { NotAuthorized } from '@/components/states/not-authorized';
import { PlaceholderPage } from '@/components/states/placeholder-page';
import DashboardPage from '@/app/(app)/dashboard/page';

/**
 * Placeholder screens must be honest (Invariants #17, #18).
 *
 * A placeholder screen does not mean a business workflow is implemented, and no
 * fake operational data may ever be displayed.
 */

const projectRoot = join(__dirname, '..', '..');
const appDir = join(projectRoot, 'src', 'app');

describe('PlaceholderPage', () => {
  it('labels itself as not implemented and names the delivering phase', () => {
    render(
      <PlaceholderPage
        title="Live"
        description="Live selling batches."
        phase="Phase 3 — Live Selling & Claim Intake"
      />,
    );

    expect(screen.getByTestId('placeholder-badge')).toHaveTextContent(
      /placeholder — not implemented/i,
    );
    expect(screen.getByText(/Phase 3 — Live Selling & Claim Intake/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live' })).toBeInTheDocument();
  });
});

describe('Dashboard placeholder', () => {
  it('is clearly labelled as a placeholder', () => {
    render(<DashboardPage />);

    expect(screen.getByTestId('placeholder-badge')).toBeInTheDocument();
  });

  it('shows an empty state instead of operational figures', () => {
    render(<DashboardPage />);

    expect(screen.getByTestId('empty-state')).toHaveTextContent(/no operational data/i);
  });

  it('displays no numeric operational data', () => {
    const { container } = render(<DashboardPage />);
    const text = container.textContent ?? '';

    // Phase references ("Phases 1–8", "Phase 9") are legitimate prose. Any OTHER
    // standalone number on the Dashboard would be fabricated, since no data model
    // exists yet.
    const withoutPhaseRefs = text.replace(/Phases?\s*[\d–—-]+/g, '');
    const currencyOrCounts = withoutPhaseRefs.match(
      /[₱$]\s?\d|\b\d{1,3}(,\d{3})+\b|\b\d+\b/g,
    );

    expect(currencyOrCounts).toBeNull();
  });
});

describe('no fake operational data anywhere in the app routes', () => {
  function collectRouteFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const fullPath = join(dir, entry);

      if (statSync(fullPath).isDirectory()) {
        return collectRouteFiles(fullPath);
      }

      return /\.tsx$/.test(fullPath) ? [fullPath] : [];
    });
  }

  it('contains no mock/fake/dummy/seed data fixtures', () => {
    const routeFiles = collectRouteFiles(appDir);

    const withFixtures = routeFiles.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return /\b(mockData|fakeData|dummyData|sampleData|seedData|MOCK_|FAKE_|DUMMY_)/.test(
        contents,
      );
    });

    expect(withFixtures).toEqual([]);
  });

  it('renders no currency amounts', () => {
    const routeFiles = collectRouteFiles(appDir);

    const withCurrency = routeFiles.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return /[₱$]\s?\d[\d,.]*/.test(contents);
    });

    expect(withCurrency).toEqual([]);
  });
});

describe('EmptyState', () => {
  it('distinguishes "nothing to show" from an error or a loading state', () => {
    render(<EmptyState title="No records" description="Nothing here yet." />);

    expect(screen.getByTestId('empty-state')).toHaveTextContent('No records');
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent(/error|failed/i);
  });
});

describe('NotAuthorized', () => {
  it('states that no record was changed', () => {
    // Bible §11.45: unauthorized actions change no record.
    render(<NotAuthorized />);

    expect(screen.getByTestId('not-authorized')).toHaveTextContent(
      /no record was changed/i,
    );
  });

  it('does not disclose which permission was missing', () => {
    render(<NotAuthorized />);

    const text = screen.getByTestId('not-authorized').textContent ?? '';

    expect(text).not.toMatch(/requires the .* permission/i);
  });
});
