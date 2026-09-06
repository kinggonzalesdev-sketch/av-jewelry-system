import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SW_PRECACHE, SW_STATIC_ALLOW } from '@/lib/pwa/cache-policy';

/**
 * public/sw.js is a plain script and cannot import the typed policy, so it carries a verbatim
 * copy. This test pins the two together: change one without the other and the build fails.
 * It also asserts the worker's structural safety rules directly in its source.
 */
const sw = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

describe('public/sw.js mirrors src/lib/pwa/cache-policy.ts', () => {
  it('contains every STATIC_ALLOW pattern verbatim', () => {
    for (const re of SW_STATIC_ALLOW) expect(sw).toContain(re.source);
  });

  it('contains every PRECACHE path verbatim', () => {
    for (const p of SW_PRECACHE) expect(sw).toContain(`'${p}'`);
  });

  it('never intervenes on non-GET, cross-origin, or unlisted requests', () => {
    expect(sw).toMatch(/if \(req\.method !== 'GET'\) return;/);
    expect(sw).toMatch(/if \(url\.origin !== self\.location\.origin\) return;/);
    expect(sw).toMatch(
      /if \(!STATIC_ALLOW\.some\(\(re\) => re\.test\(url\.pathname\)\)\) return;/,
    );
  });

  it('never caches a navigation response (HTML goes to the network; offline page only on failure)', () => {
    // The navigate branch must not call cache.put — only fetch(req) with a caches.match fallback.
    const navigate = sw.slice(
      sw.indexOf("req.mode === 'navigate'"),
      sw.indexOf('STATIC_ALLOW.some'),
    );
    expect(navigate).toContain('fetch(req)');
    // Whitespace-tolerant: prettier may break the chain across lines.
    expect(navigate).toMatch(/caches\s*\.match\('\/offline'\)/);
    expect(navigate).not.toContain('cache.put');
  });

  it('only takes over after the page asks (SKIP_WAITING), never on its own', () => {
    expect(sw).toContain("event.data.type === 'SKIP_WAITING'");
    // The install handler must not call skipWaiting.
    const install = sw.slice(
      sw.indexOf("addEventListener('install'"),
      sw.indexOf("addEventListener('activate'"),
    );
    expect(install).not.toContain('skipWaiting');
  });

  it('versions its cache from the registration URL and evicts other versions', () => {
    expect(sw).toContain("searchParams.get('v')");
    expect(sw).toContain("k.startsWith('mineflow-static-') && k !== CACHE");
  });
});
