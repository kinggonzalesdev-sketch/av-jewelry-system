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

describe('Phase 0 scope boundary', () => {
  it('creates no business migrations', () => {
    // The business schema is Phase 1. Only the README may exist here.
    const migrationsDir = join(projectRoot, 'supabase', 'migrations');
    const sqlFiles = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));

    expect(sqlFiles).toEqual([]);
  });

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
