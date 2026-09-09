package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Guards the rule that decides whether the operator stays signed in.
 *
 * THE INCIDENT (2026-09-09): refreshAccessToken returned a plain Boolean, so "Supabase rejected
 * this refresh token" and "the network hiccuped" were indistinguishable, and the caller wiped the
 * session for both. One blip during a routine token refresh signed the Capture phone out at
 * 12:44:20. PrintJobPoller gates on store.isLoggedIn, so it stopped polling and stopped
 * heartbeating; 16 real customer stickers were queued to a phone that would never ask for them
 * again, and nothing recovered it for 58 minutes until a human signed in by hand.
 *
 * The asymmetry these tests encode: a wrongly-KEPT session costs a few futile retries that clear
 * themselves at the next genuine 401. A wrongly-CLEARED session costs the whole shift's printing
 * and needs a person to notice and fix it. So when the status is ambiguous, KEEP.
 */
class RefreshOutcomeTest {

    @Test
    fun `4xx from the token endpoint means the refresh token is genuinely dead`() {
        // GoTrue answers a bad / expired / already-rotated refresh token with 400 invalid_grant.
        assertEquals(ApiClient.RefreshOutcome.REJECTED, ApiClient.classifyRefreshStatus(400))
        assertEquals(ApiClient.RefreshOutcome.REJECTED, ApiClient.classifyRefreshStatus(401))
        assertEquals(ApiClient.RefreshOutcome.REJECTED, ApiClient.classifyRefreshStatus(403))
        assertEquals(ApiClient.RefreshOutcome.REJECTED, ApiClient.classifyRefreshStatus(422))
    }

    @Test
    fun `5xx never ends a session — the server is broken, not the token`() {
        // This is the class of failure that must NOT sign anybody out. A Supabase wobble is a
        // documented failure mode for this project.
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(500))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(502))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(503))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(504))
    }

    @Test
    fun `the transient 4xx pair are treated as retryable, not as rejection`() {
        // 408 and 429 sit in the 4xx range but say nothing about the token's validity.
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(408))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(429))
    }

    @Test
    fun `unrecognised statuses keep the session — fail safe is KEEP`() {
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(0))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(-1))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(200))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(302))
        assertEquals(ApiClient.RefreshOutcome.UNAVAILABLE, ApiClient.classifyRefreshStatus(999))
    }

    @Test
    fun `no status in the whole 5xx range can ever sign the operator out`() {
        // Swept rather than sampled: one stray REJECTED here is a silent shift-long outage.
        for (code in 500..599) {
            assertEquals(
                "HTTP $code must never clear the session",
                ApiClient.RefreshOutcome.UNAVAILABLE,
                ApiClient.classifyRefreshStatus(code),
            )
        }
    }
}
