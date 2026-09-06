import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PwaProvider, usePwa } from '@/components/pwa/pwa-provider';
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from '@/components/pwa/unsaved-changes';
import { UpdateToast } from '@/components/pwa/update-toast';
import { InstallMineFlow } from '@/components/pwa/install-mineflow';

/**
 * Install state, standalone detection, online/offline, the update lifecycle and the
 * unsaved-changes guard — with a mocked service-worker container (jsdom has none).
 */

function Probe() {
  const p = usePwa();
  return (
    <div>
      <span data-testid="online">{String(p.online)}</span>
      <span data-testid="standalone">{String(p.standalone)}</span>
      <span data-testid="install-available">{String(p.installPromptAvailable)}</span>
      <span data-testid="update-ready">{String(p.updateReady)}</span>
      <span data-testid="sw">{p.serviceWorker}</span>
      <span data-testid="version">{p.version}</span>
    </div>
  );
}

// --- a minimal ServiceWorkerContainer / registration mock --------------------------------
type Listener = (e: Event) => void;
function makeSwMock() {
  const regListeners: Record<string, Listener[]> = {};
  const containerListeners: Record<string, Listener[]> = {};
  const installing = {
    state: 'installing',
    listeners: [] as Listener[],
    postMessage: vi.fn(),
    addEventListener: (_: string, fn: Listener) => installing.listeners.push(fn),
  };
  const registration = {
    installing: null as typeof installing | null,
    waiting: null as typeof installing | null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: (type: string, fn: Listener) =>
      (regListeners[type] = [...(regListeners[type] ?? []), fn]),
  };
  const container = {
    controller: {} as object, // an existing controller = this is an UPDATE, not a first install
    register: vi.fn(() => Promise.resolve(registration)),
    addEventListener: (type: string, fn: Listener) =>
      (containerListeners[type] = [...(containerListeners[type] ?? []), fn]),
    removeEventListener: vi.fn(),
  };
  const simulateNewVersionInstalled = () => {
    registration.installing = installing;
    regListeners.updatefound?.forEach((fn) => fn(new Event('updatefound')));
    installing.state = 'installed';
    installing.listeners.forEach((fn) => fn(new Event('statechange')));
  };
  const fireControllerChange = () =>
    containerListeners.controllerchange?.forEach((fn) =>
      fn(new Event('controllerchange')),
    );
  return {
    container,
    registration,
    installing,
    simulateNewVersionInstalled,
    fireControllerChange,
  };
}

let sw: ReturnType<typeof makeSwMock>;
let matchMediaMatches = false;

beforeEach(() => {
  sw = makeSwMock();
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: sw.container,
    configurable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      matches: q.includes('standalone') ? matchMediaMatches : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});
afterEach(() => {
  matchMediaMatches = false;
});

async function mount(
  ui: React.ReactNode,
  opts?: { register?: boolean; reload?: () => void },
) {
  await act(async () => {
    render(
      <UnsavedChangesProvider>
        <PwaProvider
          version="abc1234"
          registerServiceWorker={opts?.register ?? true}
          {...(opts?.reload ? { reload: opts.reload } : {})}
        >
          {ui}
        </PwaProvider>
      </UnsavedChangesProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PwaProvider', () => {
  it('registers the versioned worker URL and reports the public version', async () => {
    await mount(<Probe />);
    expect(sw.container.register).toHaveBeenCalledWith('/sw.js?v=abc1234', {
      scope: '/',
    });
    expect(screen.getByTestId('sw')).toHaveTextContent('registered');
    expect(screen.getByTestId('version')).toHaveTextContent('abc1234');
  });

  it('does not register outside production unless told to', async () => {
    await mount(<Probe />, { register: false });
    expect(sw.container.register).not.toHaveBeenCalled();
    expect(screen.getByTestId('sw')).toHaveTextContent('unregistered');
  });

  it('detects standalone (installed) mode', async () => {
    matchMediaMatches = true;
    await mount(<Probe />);
    expect(screen.getByTestId('standalone')).toHaveTextContent('true');
  });

  it('tracks online → offline → online', async () => {
    await mount(<Probe />);
    expect(screen.getByTestId('online')).toHaveTextContent('true');
    // A browser flips navigator.onLine THEN fires the event; mirror that exactly.
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('online')).toHaveTextContent('false');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByTestId('online')).toHaveTextContent('true');
  });

  it('captures beforeinstallprompt and exposes a one-tap Install button', async () => {
    await mount(
      <>
        <Probe />
        <InstallMineFlow />
      </>,
    );
    expect(screen.getByTestId('install-available')).toHaveTextContent('false');
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(screen.getByTestId('install-available')).toHaveTextContent('true');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pwa-install-button'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    // Accepted → the control now reports installed instead of offering again.
    expect(screen.getByTestId('pwa-install-installed')).toBeInTheDocument();
  });

  it('shows the manual Safari steps on iOS instead of promising a prompt', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    await mount(<InstallMineFlow />);
    expect(screen.getByTestId('pwa-install-ios')).toHaveTextContent(/Add to Home Screen/);
    expect(screen.queryByTestId('pwa-install-button')).not.toBeInTheDocument();
  });

  it('update lifecycle: a newly installed worker → updateReady → "Update now" posts SKIP_WAITING', async () => {
    await mount(
      <>
        <Probe />
        <UpdateToast />
      </>,
    );
    expect(screen.getByTestId('update-ready')).toHaveTextContent('false');
    expect(screen.queryByTestId('pwa-update-toast')).not.toBeInTheDocument();

    act(() => {
      sw.simulateNewVersionInstalled();
    });
    expect(screen.getByTestId('update-ready')).toHaveTextContent('true');
    expect(screen.getByTestId('pwa-update-toast')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pwa-update-now'));
    expect(sw.installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('update guard: with unsaved work the first click warns and does NOT update; a second click does', async () => {
    function DirtyForm() {
      useUnsavedChanges(true);
      return null;
    }
    await mount(
      <>
        <DirtyForm />
        <UpdateToast />
      </>,
    );
    act(() => {
      sw.simulateNewVersionInstalled();
    });
    fireEvent.click(screen.getByTestId('pwa-update-now'));
    expect(sw.installing.postMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('pwa-update-toast')).toHaveTextContent(
      /entry in progress/i,
    );
    expect(screen.getByTestId('pwa-update-now')).toHaveTextContent('Update anyway');
    fireEvent.click(screen.getByTestId('pwa-update-now'));
    expect(sw.installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('reloads exactly once, on controllerchange, and only after "Update now" asked', async () => {
    const reload = vi.fn();
    await mount(<UpdateToast />, { reload });
    // First install / claim: a controllerchange nobody asked for must NOT reload.
    act(() => {
      sw.fireControllerChange();
    });
    expect(reload).not.toHaveBeenCalled();

    act(() => {
      sw.simulateNewVersionInstalled();
    });
    fireEvent.click(screen.getByTestId('pwa-update-now'));
    expect(sw.installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    act(() => {
      sw.fireControllerChange();
      sw.fireControllerChange();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('multi-tab: if the new worker already took over, "Update now" reloads this tab once instead of posting to a dead worker', async () => {
    const reload = vi.fn();
    await mount(<UpdateToast />, { reload });
    act(() => {
      sw.simulateNewVersionInstalled();
    });
    // Another tab pressed "Update now": the worker we hold is now active, nothing is waiting.
    sw.installing.state = 'activated';
    fireEvent.click(screen.getByTestId('pwa-update-now'));
    const again = screen.queryByTestId('pwa-update-now');
    if (again) fireEvent.click(again);
    expect(sw.installing.postMessage).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('"Later" hides the toast without updating', async () => {
    await mount(<UpdateToast />);
    act(() => {
      sw.simulateNewVersionInstalled();
    });
    fireEvent.click(screen.getByTestId('pwa-update-later'));
    expect(screen.queryByTestId('pwa-update-toast')).not.toBeInTheDocument();
    expect(sw.installing.postMessage).not.toHaveBeenCalled();
  });
});
