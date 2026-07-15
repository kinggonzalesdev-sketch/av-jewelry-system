-- ============================================================================
-- Phase 1 — Test harness: pgTAP
-- ----------------------------------------------------------------------------
-- pgTAP is the local test runner used by `supabase test db`. It is installed
-- into a dedicated `extensions` schema and is a TEST-ONLY dependency: no
-- application code depends on it.
--
-- This migration is ordered FIRST (timestamp 115900) so the extension exists
-- before any test runs.
-- ============================================================================

create extension if not exists pgtap with schema extensions;
