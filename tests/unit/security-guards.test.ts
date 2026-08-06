import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Repository-level security and scope guards.
 *
 * These protect commitments that are easy to break silently later:
 * secrets never committed (Invariant #15), prototype code never imported
 * (Invariant #17), and no business schema created in Phase 0.
 */

const projectRoot = join(__dirname, '..', '..');

describe('secrets are never committed (Invariant #15, ADR §11)', () => {
  const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8');

  it('ignores every .env file except the example template', () => {
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });

  it('ignores key and certificate material', () => {
    expect(gitignore).toMatch(/^\*\.pem$/m);
    expect(gitignore).toMatch(/^\*\.key$/m);
  });

  it('ignores dependency and build output', () => {
    expect(gitignore).toMatch(/^node_modules\/$/m);
    expect(gitignore).toMatch(/^\.next\/$/m);
  });

  it('keeps .env.example free of real-looking credentials', () => {
    const example = readFileSync(join(projectRoot, '.env.example'), 'utf8');

    // A Supabase key is a JWT (three dot-separated base64 segments). A placeholder
    // must never look like one.
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    // The service-role slot must ship empty — startup never requires it.
    expect(example).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=\s*$/m);
  });

  it('has no committed .env.local', () => {
    // A local file may exist on a developer machine, but it must be git-ignored;
    // this asserts the ignore rule rather than the file's absence.
    expect(gitignore).toMatch(/^\.env\.\*$/m);
  });
});

describe('prototype code is not production code (Invariant #17)', () => {
  function collectFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const fullPath = join(dir, entry);

      if (statSync(fullPath).isDirectory()) {
        return collectFiles(fullPath);
      }

      return /\.(ts|tsx)$/.test(fullPath) ? [fullPath] : [];
    });
  }

  it('imports nothing from a prototype directory', () => {
    const sourceFiles = collectFiles(join(projectRoot, 'src'));

    const importingPrototype = sourceFiles.filter((file) =>
      /from\s+['"][^'"]*(ui-prototype|\/prototype)[^'"]*['"]/.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(importingPrototype).toEqual([]);
  });
});

describe('Phase 1 migration boundary', () => {
  const migrationsDir = join(projectRoot, 'supabase', 'migrations');
  const sqlFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  // Phase 0 asserted this directory was empty. Phase 1's job is to fill it, so
  // that guard is replaced — not relaxed — by the stronger checks below.
  it('has version-controlled migrations', () => {
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it('enables RLS in every migration that creates a table', () => {
    // ADR §7 / Bible §30: a business table must never exist in an exposed state,
    // so RLS must be enabled in the SAME migration that creates it. This catches
    // the mistake statically, before a reviewer or the database has to.
    const offenders = sqlFiles.filter((file) => {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      const createdTables = [
        ...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi),
      ].map((match) => match[1]);

      return createdTables.some(
        (table) =>
          !new RegExp(
            `alter table public\\.${table} enable row level security`,
            'i',
          ).test(sql),
      );
    });

    expect(offenders).toEqual([]);
  });

  it('never disables RLS', () => {
    const offenders = sqlFiles.filter((file) =>
      /disable row level security/i.test(readFileSync(join(migrationsDir, file), 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('pins search_path on every security definer function', () => {
    // An unpinned search_path on a SECURITY DEFINER function is a privilege
    // escalation path. Phase 1 defines none, but this guards future additions.
    //
    // Match only real DEFINITIONS: strip SQL comments first, so a migration that
    // merely MENTIONS "security definer" in a comment (e.g. a GRANT/REVOKE
    // hardening migration that defines no function) is not a false positive. This
    // also makes the guard stronger — a `set search_path` that lives only in a
    // comment no longer satisfies it for a real function definition.
    const stripComments = (sql: string) =>
      sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    const offenders = sqlFiles.filter((file) => {
      const sql = stripComments(readFileSync(join(migrationsDir, file), 'utf8'));
      if (!/security definer/i.test(sql)) return false;
      return !/set search_path/i.test(sql);
    });

    expect(offenders).toEqual([]);
  });

  it('seeds no real staff, customer, item, claim, or order data', () => {
    // Only structural reference data (roles, permissions, device-limit targets)
    // may be seeded. Real operational rows must never ship in a migration.
    const businessTables = [
      'staff_profiles',
      'customers',
      'inventory_items',
      'claims',
      'official_orders',
      'payments',
      'live_batches',
    ];

    const offenders = sqlFiles.flatMap((file) => {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      // Strip dollar-quoted function BODIES before scanning.
      //
      // The rule is "a migration must not SHIP operational rows". An INSERT
      // inside a function body ships nothing — it is runtime logic that only
      // executes when an authorized caller invokes it (Phase 4's
      // confirm_claim_and_print and Phase 5's approve_and_send_invoice both
      // legitimately insert business rows at runtime). A top-level INSERT is a
      // seed, and that is what this guard exists to catch, so only top-level
      // statements are scanned.
      // PostgreSQL dollar-quoting allows NAMED tags ($function$…$function$), not
      // only $$…$$ — strip either so a function body never trips the seed guard.
      const topLevel = sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '');

      return businessTables
        .filter((table) =>
          new RegExp(`insert into public\\.${table}\\b`, 'i').test(topLevel),
        )
        .map((table) => `${file}: ${table}`);
    });

    expect(offenders).toEqual([]);
  });

  it('still catches a real seed after stripping function bodies', () => {
    // Proves the exemption above did not gut the guard. A guard that cannot
    // fail is not a guard, so this asserts the detection itself: a top-level
    // seed is caught, while the same statement inside a function body is not.
    const strip = (sql: string) => sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '');
    const detects = (sql: string) => /insert into public\.customers\b/i.test(strip(sql));

    expect(detects("insert into public.customers (display_name) values ('Real');")).toBe(
      true,
    );
    expect(
      detects(
        `create function f() returns void language plpgsql as $$
         begin insert into public.customers (display_name) values ('Runtime'); end;
         $$;`,
      ),
    ).toBe(false);
    // A NAMED dollar-quote tag ($function$) is stripped just the same.
    expect(
      detects(
        `create function f() returns void language plpgsql as $function$
         begin insert into public.customers (display_name) values ('Runtime'); end;
         $function$;`,
      ),
    ).toBe(false);
  });
});

describe('Phase 1 scope boundary', () => {
  it('creates no business domain modules', () => {
    const modulesDir = join(projectRoot, 'src', 'modules');
    const moduleFiles = readdirSync(modulesDir).filter((file) => file !== 'README.md');

    expect(moduleFiles).toEqual([]);
  });

  it('does not weaken the TypeScript build gate', () => {
    const nextConfig = readFileSync(join(projectRoot, 'next.config.ts'), 'utf8');

    expect(nextConfig).toMatch(/ignoreBuildErrors:\s*false/);
    expect(nextConfig).not.toMatch(/ignoreBuildErrors:\s*true/);
  });

  it('keeps lint as a mandatory gate in the verify script', () => {
    // Next 16 removed `next lint` and the `eslint` config key, so the build no
    // longer lints. `npm run verify` is what keeps lint enforced.
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.lint).toBe('eslint .');
    expect(packageJson.scripts.verify).toContain('npm run lint');
    expect(packageJson.scripts.verify).toContain('npm run typecheck');
    expect(packageJson.scripts.verify).toContain('npm run test');
    expect(packageJson.scripts.verify).toContain('npm run build');
  });

  it('pins TypeScript to exactly 5.9.3', () => {
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as { devDependencies: Record<string, string> };

    // Exact pin, no range prefix: @typescript-eslint supports >=4.8.4 <6.1.0,
    // so TS 6.x/7.x would break the ESLint type gate (ADR §17).
    expect(packageJson.devDependencies.typescript).toBe('5.9.3');
  });

  it('keeps TypeScript strict mode enabled', () => {
    const tsconfig = readFileSync(join(projectRoot, 'tsconfig.json'), 'utf8');

    expect(tsconfig).toMatch(/"strict":\s*true/);
  });
});

describe('planning documents remain present and authoritative (ADR §2)', () => {
  const planningDocs = [
    'Development-Bible.md',
    'IMPLEMENTATION-ROADMAP.md',
    'PHASE-0-ARCHITECTURE-DECISIONS.md',
  ];

  it.each(planningDocs)('%s exists', (doc) => {
    expect(existsSync(join(projectRoot, doc))).toBe(true);
  });

  it('excludes planning documents from formatting', () => {
    // `prettier --write .` must never reformat an approved document.
    const prettierIgnore = readFileSync(join(projectRoot, '.prettierignore'), 'utf8');

    for (const doc of planningDocs) {
      expect(prettierIgnore).toContain(doc);
    }
  });
});
