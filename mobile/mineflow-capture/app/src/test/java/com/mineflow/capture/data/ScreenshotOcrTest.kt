package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pure-JVM tests for the PINNED-comment selection (no device / no ML Kit needed — we feed
 * the recognised lines + boxes directly to guessFrom). Layout mirrors the real FB Live
 * broadcaster screen the operator uses: scrolling "…is watching" bubbles above, the PINNED
 * comment (name then "Mine X") at the bottom.
 */
class ScreenshotOcrTest {

    /** One recognised line at vertical position `top`. All lines share an x-range so the only
     *  discriminator is VERTICAL position (name directly above its claim). */
    private fun line(text: String, top: Int) = OLine(text, Box(40, top, 400, top + 40))

    private fun pinnedGrams(claim: String): String? =
        ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line(claim, 900))).grams

    // Test 1 — the pinned name wins; an unrelated visible name is ignored.
    @Test
    fun test1_pinnedName_ignoresOtherVisibleName() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Andrea Dela Cruz is watching.", 100),
                line("Ulymay Alazne Pedericoc", 200), // visible elsewhere — NOT pinned
                line("Khim Escarez is watching.", 400),
                line("Chin Cha", 850), // pinned name (bottom)
                line("Mine 5.5", 900), // pinned claim, directly below
            ),
        )
        assertEquals("Chin Cha", g.fbName)
        assertEquals("5.5", g.grams)
    }

    // Test 2 — several claims visible; the PINNED (bottom-most) one is chosen, with ITS name.
    @Test
    fun test2_multipleClaims_picksBottomMostPinned() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Maria Reyes", 400),
                line("Mine 8.2", 450), // a scrolling claim (higher)
                line("Chin Cha", 850), // pinned (bottom)
                line("Mine 5.5", 900),
            ),
        )
        assertEquals("Chin Cha", g.fbName)
        assertEquals("5.5", g.grams)
    }

    // Test 4 — grams formats (Mine / M / bare / .5 / whole).
    @Test
    fun test4_gramsFormats() {
        assertEquals("10.5", pinnedGrams("Mine 10.5"))
        assertEquals("10.5", pinnedGrams("M 10.5"))
        assertEquals("10.5", pinnedGrams("10.5"))
        assertEquals("0.5", pinnedGrams(".5"))
        assertEquals("11", pinnedGrams("11"))
    }

    // Low confidence — a claim with no name-like line directly above it → needs review.
    // STRUCTURAL (Owner 2026-08-20): with NO associated name, grams is dropped too — a number is
    // never kept without a real name/comment block. The whole capture is "needs review".
    @Test
    fun lowConfidence_noNameAbove_needsReview() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Andrea Dela Cruz is watching.", 100), // filtered + far above
                line("Mine 5.5", 900),
            ),
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // The real layouts from the operator's screenshots (multi-word names, varied claims).
    @Test
    fun realLayouts_fromScreenshots() {
        fun run(name: String, claim: String): OcrGuess = ScreenshotOcr.guessFrom(
            listOf(
                line("Ericka Dilag De Dios is watching.", 100),
                line("Andrea Dela Cruz is watching.", 300),
                line("Khim Escarez is watching.", 500),
                line(name, 850),
                line(claim, 900),
            ),
        )
        run("Ericka Dilag De Dios", "Mine 2.33").let {
            assertEquals("Ericka Dilag De Dios", it.fbName); assertEquals("2.33", it.grams)
        }
        run("Khim Escarez", "Mine 8.60").let {
            assertEquals("Khim Escarez", it.fbName); assertEquals("8.6", it.grams)
        }
        run("Andrea Dela Cruz", "MINE 1.23").let {
            assertEquals("Andrea Dela Cruz", it.fbName); assertEquals("1.23", it.grams)
        }
    }

    // The VIEWER (customer) live layout from the attached screenshots: pinned comments with
    // TRAILING TEXT and unrelated question-comments above (incl. the real "Ulymay" case).
    @Test
    fun viewerLayout_trailingText_and_unrelatedComments() {
        // SS4: pinned "Elve Cano / 13.91"; "Ulymay Alazne Pedericos ..." is a normal question
        // above (no leading number) and must NOT be selected.
        val ss4 = ScreenshotOcr.guessFrom(
            listOf(
                line("Rodora Bellones Canete", 200),
                line("Madam bracelet na suot mo mam hardware", 250),
                line("Ulymay Alazne Pedericos", 350),
                line("anu po pendant na panlalaki meron kayu maam?", 400),
                line("Charvin BPagtakhan", 600),
                line("Mine type ko yung tri color maam ko hehhehe", 650),
                line("Elve Cano", 850),
                line("13.91", 900),
            ),
        )
        assertEquals("Elve Cano", ss4.fbName)
        assertEquals("13.91", ss4.grams)

        // SS2: "Mine 2.43g LV" — trailing "g LV" must not reject the claim.
        val ss2 = ScreenshotOcr.guessFrom(
            listOf(line("Lhean Elbanbuena", 850), line("Mine 2.43g LV", 900)),
        )
        assertEquals("Lhean Elbanbuena", ss2.fbName)
        assertEquals("2.43", ss2.grams)
        assertEquals("2.43", ss2.itemQuery)

        // SS5: "Mine 5.67 foxtail".
        val ss5 = ScreenshotOcr.guessFrom(
            listOf(line("Abby Gicain", 850), line("Mine 5.67 foxtail", 900)),
        )
        assertEquals("Abby Gicain", ss5.fbName)
        assertEquals("5.67", ss5.grams)

        // SS3: bare number "6.53".
        val ss3 = ScreenshotOcr.guessFrom(
            listOf(line("Divina Bose Madayam", 850), line("6.53", 900)),
        )
        assertEquals("Divina Bose Madayam", ss3.fbName)
        assertEquals("6.53", ss3.grams)
    }

    // Fixed-price pinned comments: the value is extracted (itemQuery) so the PC can price it,
    // but grams stays null (never a grams sticker on the phone). Name still from the block.
    @Test
    fun fixedPrice_valuesExtracted_gramsNull() {
        fun g(claim: String) =
            ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line(claim, 900)))
        g("Mine 12000").let { assertEquals("12000", it.itemQuery); assertNull(it.grams) }
        g("12,000").let { assertEquals("12,000", it.itemQuery); assertNull(it.grams) }
        g("12k").let { assertEquals("12k", it.itemQuery); assertNull(it.grams) }
        g("12.5k").let { assertEquals("12.5k", it.itemQuery); assertNull(it.grams) }
        g("12500").let { assertEquals("12500", it.itemQuery); assertNull(it.grams) }
        assertEquals("Buyer Name", g("Mine 12000").fbName)
    }

    // Owner acceptance grams matrix (2026-08-18): leading decimals normalized, keyword BEFORE
    // and AFTER the number, case-insensitive, numeric-only, "g" suffix — all from the pinned block.
    @Test
    fun acceptanceGramsMatrix_allFormats() {
        assertEquals("0.6", pinnedGrams(".6"))
        assertEquals("0.7", pinnedGrams(".7"))
        assertEquals("0.8", pinnedGrams(".8"))
        assertEquals("0.9", pinnedGrams(".9"))
        assertEquals("1.5", pinnedGrams("M 1.5"))
        assertEquals("1.5", pinnedGrams("Mine 1.5"))
        assertEquals("1.5", pinnedGrams("MINE 1.5"))
        assertEquals("1.5", pinnedGrams("mine 1.5"))
        assertEquals("1.5", pinnedGrams("1.5 M"))
        assertEquals("1.5", pinnedGrams("1.5 Mine"))
        assertEquals("1.5", pinnedGrams("1.5 mine"))
        assertEquals("1.5", pinnedGrams("1.5g"))
        assertEquals("1.5", pinnedGrams("1.5 g"))
        assertEquals("11", pinnedGrams("11"))
        assertEquals("10.5", pinnedGrams("10.5"))
        // keyword AFTER a leading-decimal, both orders:
        assertEquals("0.7", pinnedGrams("M .7"))
        assertEquals("0.7", pinnedGrams("Mine .7"))
        assertEquals("0.7", pinnedGrams(".7 M"))
        assertEquals("0.7", pinnedGrams(".7 Mine"))
    }

    // Name + grams come from the SAME pinned block.
    @Test
    fun acceptanceNameAndGrams_sameBlock() {
        val g = ScreenshotOcr.guessFrom(listOf(line("Juan Dela Cruz", 850), line("Mine .7", 900)))
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("0.7", g.grams)
    }

    // Facebook UI tab "Overview" sitting DIRECTLY above the claim must NOT become the printed
    // name — rejected → needs review. With no real name, grams is dropped too (structural).
    @Test
    fun overviewDirectlyAboveClaim_isRejected_notPrinted() {
        val g = ScreenshotOcr.guessFrom(listOf(line("Overview", 860), line("Mine .7", 900)))
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // With FB tab chrome AND a real pinned name on screen, the real name wins; tabs never do.
    @Test
    fun realNameWinsOverUiTabs() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Overview", 815),
                line("Live chat", 835),
                line("Your replies", 850),
                line("Juan Dela Cruz", 862),
                line("11.5", 905),
            ),
        )
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("11.5", g.grams)
    }

    // Full-screen FALLBACK safety (minClaimTop = the pinned/bottom zone): a claim ABOVE the pinned
    // zone is NEVER used — the fallback must positively locate the pinned block in the bottom band,
    // else no local sticker data (needs review). A non-pinned/scrolling comment can't become data.
    @Test
    fun fullScreenFallback_rejectsClaimAbovePinnedZone() {
        val lines = listOf(line("Maria Reyes", 300), line("Mine 8.2", 350))
        val gated = ScreenshotOcr.guessFrom(lines, minClaimTop = 500)
        assertNull(gated.fbName)
        assertNull(gated.grams)
        // Prove the GATE is what blocks it: unconstrained (ROI-crop pass), the same block is used.
        val ungated = ScreenshotOcr.guessFrom(lines)
        assertEquals("Maria Reyes", ungated.fbName)
        assertEquals("8.2", ungated.grams)
    }

    @Test
    fun fullScreenFallback_usesPinnedZoneBlock() {
        val g = ScreenshotOcr.guessFrom(
            listOf(line("Juan Dela Cruz", 850), line("Mine .7", 900)),
            minClaimTop = 500,
        )
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("0.7", g.grams)
    }

    // GENERIC parser (Owner 2026-08-18): arbitrary non-numeric words (any language / emoji) before,
    // between, or after the value are ignored; the Mine/M/g marker is optional + order-independent.
    // These fixed strings only ILLUSTRATE the rule — see the property test for the real proof.
    @Test
    fun genericParser_arbitraryWordsIgnored() {
        assertEquals("1.1", pinnedGrams("Mine 1.1 rolex"))
        assertEquals("1.1", pinnedGrams("rolex Mine 1.1"))
        assertEquals("1.1", pinnedGrams("bracelet Mine 1.1"))
        assertEquals("1.1", pinnedGrams("Mine necklace 1.1"))
        assertEquals("1.1", pinnedGrams("1.1 Mine ring"))
        assertEquals("0.7", pinnedGrams("Mine .7 bracelet"))
        assertEquals("0.7", pinnedGrams(".7 gusto ko ito"))
        assertEquals("0.8", pinnedGrams("mine .8 akin"))
        assertEquals("0.9", pinnedGrams("kuha ko Mine .9"))
        assertEquals("2.35", pinnedGrams("MINE 2.35 reserve"))
        assertEquals("2.35", pinnedGrams("reserve Mine 2.35"))
        assertEquals("2.35", pinnedGrams("2.35g reserve"))
        assertEquals("10.5", pinnedGrams("bracelet 10.5 Mine"))
        assertEquals("1.25", pinnedGrams("mine 1.25 ❤️"))
        assertEquals("1.25", pinnedGrams("❤️ mine 1.25 please"))
        assertEquals("1.5", pinnedGrams("akin na 1.5 Mine"))
        assertEquals("3.38", pinnedGrams("Mine please 3.38 sakin"))
        // a number EMBEDDED in a code/word (not a whole token) is NOT grams:
        assertEquals("1.5", pinnedGrams("Mine 1.5 K18"))
    }

    // Multiple weight-like numbers in the SAME pinned block → NEVER guess → needs review (null).
    @Test
    fun genericParser_multipleNumbers_needsReview() {
        assertNull(pinnedGrams("Mine 1.1 2.5"))
        assertNull(pinnedGrams("1.1 2.5 Mine"))
        assertNull(pinnedGrams("2.5 rolex 1.1"))
    }

    // A fixed-price form (k / comma / >999) is NOT grams (kept as itemQuery for the PC only).
    @Test
    fun genericParser_fixedPriceNotGrams() {
        assertNull(pinnedGrams("Mine 12000"))
        assertNull(pinnedGrams("12,000"))
        assertNull(pinnedGrams("12k"))
        // grams + price in one line → the single weight is used; the price is ignored.
        assertEquals("1.5", pinnedGrams("Mine 1.5 12000"))
    }

    // PROPERTY-STYLE: ANY unknown non-numeric words (not in the examples above) around
    // "Mine <grams>" yield the SAME grams — proving the parser is generic, not word-list based.
    @Test
    fun genericParser_property_unknownWordsDoNotChangeGrams() {
        val words = listOf("qwertyz", "zzxx", "kahitano", "布", "naa", "po", "###", "b@ng", "LV")
        for (w in words) {
            assertEquals("1.5", pinnedGrams("Mine 1.5 $w"))
            assertEquals("1.5", pinnedGrams("$w Mine 1.5"))
            assertEquals("1.5", pinnedGrams("Mine $w 1.5"))
            assertEquals("1.5", pinnedGrams("1.5 Mine $w"))
            assertEquals("0.7", pinnedGrams("$w .7"))
        }
    }

    // Merged name + claim on ONE line (no separate name line above) → stripClaim isolates the name
    // using the SAME whole-token rule (drops the marker + the number token, incl. leading decimals).
    @Test
    fun mergedNameAndClaim_oneLine_stripClaimExtractsName() {
        ScreenshotOcr.guessFrom(listOf(line("King Gonzales Mine 1.5", 900))).let {
            assertEquals("King Gonzales", it.fbName)
            assertEquals("1.5", it.grams)
        }
        ScreenshotOcr.guessFrom(listOf(line("Juan Dela Cruz Mine .7", 900))).let {
            assertEquals("Juan Dela Cruz", it.fbName)
            assertEquals("0.7", it.grams)
        }
        ScreenshotOcr.guessFrom(listOf(line("Abby Gicain 2.43g", 900))).let {
            assertEquals("Abby Gicain", it.fbName)
            assertEquals("2.43", it.grams)
        }
    }

    // --- Facebook UI chrome must NEVER become a customer name (Owner 2026-08-19) ----------------
    // OCR merged the FB Live tab bar ("Overview" + "Live" badge) onto one line "Overview Live",
    // which the exact-line UI_TAB match missed → it became the fbName. The structural all-chrome
    // rule now rejects any line whose tokens are ALL chrome; if the only name candidate is chrome,
    // fbName is null (Needs Review) — never a manufactured Facebook name.

    @Test
    fun chrome_mergedOverviewLive_isNotAcceptedAsName() {
        val g = ScreenshotOcr.guessFrom(listOf(line("Overview Live", 850), line("Mine 1.5", 900)))
        assertNull(g.fbName)  // chrome rejected → no guessed identity (Overview-Live protection kept)
        assertNull(g.grams)   // structural: no real name block → grams dropped too (needs review)
    }

    @Test
    fun chrome_singleTabLabels_areRejected() {
        for (chrome in listOf("Overview", "Live chat", "Your replies", "Comments")) {
            val g = ScreenshotOcr.guessFrom(listOf(line(chrome, 850), line("Mine 1.5", 900)))
            assertNull("'$chrome' must not be a customer name", g.fbName)
        }
    }

    @Test
    fun chrome_mergedOnClaimLine_stripClaimRejectsIt() {
        // Claim line itself is chrome + a number: stripping marker/number leaves "Overview Live",
        // which the chrome guard rejects → no name → Needs Review (grams dropped too, structural).
        val g = ScreenshotOcr.guessFrom(listOf(line("Overview Live Mine 1.5", 900)))
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    @Test
    fun chrome_aboveClaim_realNameCloser_picksTheRealName() {
        // Chrome higher up must NOT displace the real name directly above the claim.
        val g = ScreenshotOcr.guessFrom(
            listOf(line("Overview Live", 800), line("King Gonzales", 850), line("Mine 1.5", 900)),
        )
        assertEquals("King Gonzales", g.fbName)
        assertEquals("1.5", g.grams)
    }

    @Test
    fun chrome_withAmbiguousClaim_bothNull_needsReview() {
        // The exact rehearsal failure shape: chrome name + ambiguous claim (2 weights) → Needs
        // Review (no name, no grams), never "Overview Live".
        val g = ScreenshotOcr.guessFrom(listOf(line("Overview Live", 850), line("Mine 1.1 2.5", 900)))
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    @Test
    fun realNames_stillAccepted_afterChromeGuard() {
        ScreenshotOcr.guessFrom(listOf(line("Danica Dayoha", 850), line("Mine 1.5", 900))).let {
            assertEquals("Danica Dayoha", it.fbName)
            assertEquals("1.5", it.grams)
        }
        ScreenshotOcr.guessFrom(listOf(line("King Gonzales", 850), line("Mine .7", 900))).let {
            assertEquals("King Gonzales", it.fbName)
            assertEquals("0.7", it.grams)
        }
        // A real name that merely CONTAINS a chrome word keeps its non-chrome token.
        ScreenshotOcr.guessFrom(listOf(line("Home Reyes", 850), line("Mine 2.43g", 900))).let {
            assertEquals("Home Reyes", it.fbName)
            assertEquals("2.43", it.grams)
        }
    }

    // --- Facebook ACTUAL-LIVE OCR safety (Owner 2026-08-20) --------------------------------------
    // During an actual Live (nothing pinned) the bottom band shows the FB composer banner
    // "Send 200 Stars to pin your comment here". Its "200" must NEVER be grams; a UI number must
    // never pair with a customer name; grams is kept ONLY when tied to a real name/comment block.

    // Test 4 — the "Send 200 Stars to pin your comment here" banner never yields grams 200.
    @Test
    fun liveBanner_send200Stars_neverBecomesGrams() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("King Gonzales", 850),
                line("Send 200 Stars to pin your comment here", 905),
            ),
        )
        assertNull(g.grams) // banner is chrome → not a claim → 200 is never grams
        assertNull(g.itemQuery)
    }

    // Test 5 — a Facebook Live UI number cannot pair with a customer claim (no name block → review).
    @Test
    fun liveUiNumber_cannotPairWithCustomerClaim() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Andrea Dela Cruz is watching.", 100), // filtered, far above
                line("200", 905), // a stray UI number, no name/comment block of its own
            ),
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // Test 6 — valid live comment "King Gonzales / 18.4 Mine Subasta M" → 18.4.
    @Test
    fun liveValid_kingGonzales_subasta_18point4() {
        val g = ScreenshotOcr.guessFrom(
            listOf(line("King Gonzales", 850), line("18.4 Mine Subasta M", 905)),
        )
        assertEquals("King Gonzales", g.fbName)
        assertEquals("18.4", g.grams)
    }

    // Test 7 — valid live comment "Glaiza Sale Galang / Mine 9.0" → 9 (9.0 normalizes to 9).
    @Test
    fun liveValid_glaiza_mine_9() {
        val g = ScreenshotOcr.guessFrom(
            listOf(line("Glaiza Sale Galang", 850), line("Mine 9.0", 905)),
        )
        assertEquals("Glaiza Sale Galang", g.fbName)
        assertEquals("9", g.grams)
    }

    // Test 8 — the replay ".7" case still works (leading-decimal preserved).
    @Test
    fun replay_leadingDecimal_point7_stillWorks() {
        val g = ScreenshotOcr.guessFrom(listOf(line("King Gonzales", 850), line("Mine .7", 905)))
        assertEquals("King Gonzales", g.fbName)
        assertEquals("0.7", g.grams)
    }

    // "M 1.5 subasta rolex" is valid ONLY when safely associated with a name/comment block.
    @Test
    fun liveValid_M_grams_subasta_rolex_whenNameAssociated() {
        val g = ScreenshotOcr.guessFrom(
            listOf(line("King Gonzales", 850), line("M 1.5 subasta rolex", 905)),
        )
        assertEquals("King Gonzales", g.fbName)
        assertEquals("1.5", g.grams)
    }

    // --- Grams vs Fixed Price: the task's explicit value matrix, WITH a name (Owner 2026-08-21) ----

    // Grams: leading decimals get a leading zero and stay grams (never a whole number); decimals
    // pass through; trailing zeros are dropped by convention (.10 → 0.1). Name from the same block.
    @Test
    fun taskGramsMatrix_withName() {
        fun run(claim: String) =
            ScreenshotOcr.guessFrom(listOf(line("King Gonzales", 850), line(claim, 900)))
        run("Mine .10").let { assertEquals("King Gonzales", it.fbName); assertEquals("0.1", it.grams) }
        run("Mine .20").let { assertEquals("0.2", it.grams) }
        run("Mine .45").let { assertEquals("0.45", it.grams) }
        run(".45 Mine").let { assertEquals("0.45", it.grams) }
        run("Mine 0.45").let { assertEquals("0.45", it.grams) }
        run("Mine 1.5").let { assertEquals("1.5", it.grams) }
        run("Mine 3.39").let { assertEquals("3.39", it.grams) }
        run("Mine 11.9").let { assertEquals("11.9", it.grams) }
    }

    // Fixed-price integers/k/comma WITH a name: the value is extracted for the PC (itemQuery), grams
    // stays null (never a grams sticker on the phone). The PC classifies it as Fixed.
    @Test
    fun taskFixedValues_extracted_withName() {
        fun run(claim: String) =
            ScreenshotOcr.guessFrom(listOf(line("King Gonzales", 850), line(claim, 900)))
        run("Mine 15000").let {
            assertEquals("King Gonzales", it.fbName); assertEquals("15000", it.itemQuery); assertNull(it.grams)
        }
        run("Mine 15,000").let { assertEquals("15,000", it.itemQuery); assertNull(it.grams) }
        run("Mine 15k").let { assertEquals("15k", it.itemQuery); assertNull(it.grams) }
        run("Mine 15K").let { assertEquals("15K", it.itemQuery); assertNull(it.grams) }
    }

    // Peso-marker boundary on the phone: a FUSED ₱/P prefix ("₱15,000", "P15000") is not a number
    // token → Needs Review; the operator sets the price on the PC, where parseFixedPrice/
    // classifyCaptureValue understand ₱/P/PHP. A space-separated "PHP 15000" still extracts the bare
    // "15000" (grams null → the PC classifies it Fixed).
    @Test
    fun pesoMarker_fusedPrefix_needsReview_spacedPhpExtractsNumber() {
        fun run(claim: String) =
            ScreenshotOcr.guessFrom(listOf(line("King Gonzales", 850), line(claim, 900)))
        run("Mine ₱15,000").let { assertNull(it.grams); assertNull(it.itemQuery) }
        run("Mine P15000").let { assertNull(it.grams); assertNull(it.itemQuery) }
        run("Mine PHP 15000").let { assertEquals("15000", it.itemQuery); assertNull(it.grams) }
    }

    // --- Adaptive recovery zone via the full-screen fallback (Owner 2026-08-21) -------------------
    // Fast path (bottom 40%, top >= 0.60) is UNCHANGED. When it finds nothing, the fallback may
    // inspect the bottom 55% ([0.45, 0.60)) to recover a pinned comment pushed up by large fonts /
    // Facebook display scaling — but a recovery-area claim is used ONLY when it is the SINGLE
    // unambiguous strong candidate (exactly one claim, concrete value, same-block name). Two+ claims,
    // ambiguous value, unclear name, or chrome/banner → Needs Review. No bottom-most guess.

    /** One pinned block (name just above its claim) at fraction [claimFrac] of a screen of height
     *  [h], read through the FULL-SCREEN FALLBACK gate (established 0.60, recovery floor 0.45). */
    private fun fallback(h: Int, claim: String, claimFrac: Double, name: String = "Buyer Name"): OcrGuess {
        val claimTop = (h * claimFrac).toInt()
        val nameTop = claimTop - 60
        return ScreenshotOcr.guessFrom(
            listOf(
                OLine(name, Box(40, nameTop, 400, nameTop + 40)),
                OLine(claim, Box(40, claimTop, 400, claimTop + 40)),
            ),
            minClaimTop = (h * 0.60).toInt(),
            recoveryFloor = (h * 0.45).toInt(),
        )
    }

    // A — established fast-path zone, tall 1080x2400, claim at 0.77 → accepted.
    @Test
    fun recoveryA_established_2400_at077_accepted() {
        val g = fallback(2400, "Mine 3.39", 0.77, name = "King Gonzales")
        assertEquals("King Gonzales", g.fbName)
        assertEquals("3.39", g.grams)
    }

    // B — established zone, 1080x1920, claim at 0.71 → accepted.
    @Test
    fun recoveryB_established_1920_at071_accepted() {
        val g = fallback(1920, "Mine 1.5", 0.71, name = "Danica Dayoha")
        assertEquals("Danica Dayoha", g.fbName)
        assertEquals("1.5", g.grams)
    }

    // C — recovery zone, 1080x1920, SINGLE clear claim at 0.55 → accepted.
    @Test
    fun recoveryC_recovery_1920_at055_singleAccepted() {
        val g = fallback(1920, "Mine 2.43g", 0.55, name = "Abby Gicain")
        assertEquals("Abby Gicain", g.fbName)
        assertEquals("2.43", g.grams)
    }

    // D — recovery zone, 720x1280, single clear claim at 0.52 → accepted (K: leading decimal .45).
    @Test
    fun recoveryD_recovery_1280_at052_singleAccepted() {
        val g = fallback(1280, "Mine .45", 0.52, name = "Juan Dela Cruz")
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("0.45", g.grams)
    }

    // E — recovery zone, 1200x1920, single clear claim at 0.50 → accepted.
    @Test
    fun recoveryE_recovery_1920_at050_singleAccepted() {
        val g = fallback(1920, "Mine 11.9", 0.50, name = "Glaiza Sale Galang")
        assertEquals("Glaiza Sale Galang", g.fbName)
        assertEquals("11.9", g.grams)
    }

    // F — above the recovery floor (claim at 0.30) → rejected / Needs Review.
    @Test
    fun recoveryF_aboveFloor_at030_rejected() {
        val g = fallback(1920, "Mine 1.5", 0.30, name = "King Gonzales")
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // G — recovery zone with TWO valid Mine comments → Needs Review (never auto-pick one).
    @Test
    fun recoveryG_twoClaimsInRecovery_needsReview() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("Maria Reyes", Box(40, 900, 400, 940)),
                OLine("Mine 1.5", Box(40, 945, 400, 985)),
                OLine("Juan Cruz", Box(40, 1000, 400, 1040)),
                OLine("Mine 2.5", Box(40, 1045, 400, 1085)),
            ),
            minClaimTop = (h * 0.60).toInt(),   // 1152
            recoveryFloor = (h * 0.45).toInt(), // 864
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // H — recovery zone, single claim but NO safe same-block name (name far above) → Needs Review.
    @Test
    fun recoveryH_recoveryClaim_unclearName_needsReview() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("Maria Reyes", Box(40, 600, 400, 640)),  // far above the claim (gap ~360px)
                OLine("Mine 1.5", Box(40, 1000, 400, 1040)),   // recovery zone, no adjacent name
            ),
            minClaimTop = (h * 0.60).toInt(),
            recoveryFloor = (h * 0.45).toInt(),
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // I — "Send 200 Stars…" banner in the recovery band → 200 never grams (Needs Review).
    @Test
    fun recoveryI_send200Stars_rejected() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("King Gonzales", Box(40, 1000, 400, 1040)),
                OLine("Send 200 Stars to pin your comment here", Box(40, 1050, 400, 1090)),
            ),
            minClaimTop = (h * 0.60).toInt(),
            recoveryFloor = (h * 0.45).toInt(),
        )
        assertNull(g.grams)
        assertNull(g.itemQuery)
    }

    // J — a Facebook UI number in the recovery band with no real comment block → never grams.
    @Test
    fun recoveryJ_uiNumber_rejected() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("Live chat", Box(40, 1000, 400, 1040)),  // chrome tab label
                OLine("2.5", Box(40, 1050, 400, 1090)),         // stray number, no name block
            ),
            minClaimTop = (h * 0.60).toInt(),
            recoveryFloor = (h * 0.45).toInt(),
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // K — leading decimal .45 → 0.45g (parser unchanged; also proven in D within the recovery zone).
    @Test
    fun recoveryK_leadingDecimal_045() {
        assertEquals("0.45", pinnedGrams(".45"))
    }

    // L — fixed price 15k / 15000 still recognized (value extracted, grams null), incl. from recovery.
    @Test
    fun recoveryL_fixedPrice_recognized() {
        ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line("Mine 15k", 900))).let {
            assertEquals("15k", it.itemQuery); assertNull(it.grams)
        }
        ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line("Mine 15000", 900))).let {
            assertEquals("15000", it.itemQuery); assertNull(it.grams)
        }
        val rec = fallback(1920, "Mine 15000", 0.55, name = "King Gonzales")
        assertEquals("King Gonzales", rec.fbName)
        assertEquals("15000", rec.itemQuery)
        assertNull(rec.grams)
    }

    // SAFETY — an established pinned claim wins; a higher recovery-zone claim is IGNORED, not merged
    // into the decision (a scrolling comment in the recovery band can't hijack a real pinned one).
    @Test
    fun recovery_establishedPresent_ignoresRecoveryClaim() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("Scroller Name", Box(40, 1000, 400, 1040)),  // recovery zone
                OLine("Mine 9.9", Box(40, 1045, 400, 1085)),       // recovery claim → ignored
                OLine("King Gonzales", Box(40, 1400, 400, 1440)),  // established zone (pinned)
                OLine("Mine 1.5", Box(40, 1445, 400, 1485)),
            ),
            minClaimTop = (h * 0.60).toInt(),   // 1152
            recoveryFloor = (h * 0.45).toInt(), // 864
        )
        assertEquals("King Gonzales", g.fbName)
        assertEquals("1.5", g.grams)
    }

    // SAFETY — a lone recovery-zone claim that is itself ambiguous (two weights, value null) →
    // Needs Review, even though it is the only candidate. The value must be concrete.
    @Test
    fun recovery_singleButAmbiguousValue_needsReview() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("King Gonzales", Box(40, 1000, 400, 1040)),
                OLine("Mine 1.1 2.5", Box(40, 1050, 400, 1090)),   // two weights → value null
            ),
            minClaimTop = (h * 0.60).toInt(),
            recoveryFloor = (h * 0.45).toInt(),
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // OWNER 2026-08-22 — real operator test: leading-decimal weights (.xx) SOMETIMES became
    // "Name not read". Diagnosis from the STORED capture OCR (capture_records.ocr): the numeric
    // PARSER is correct — every .xx normalises to 0.xx grams; the failures were rapid-fire screens
    // with MULTIPLE / duplicate values near the pinned anchor, which the wrong-customer safety gate
    // correctly sends to Needs Review. `.88` "passed for Gen but failed for King" = capture LAYOUT/
    // timing (one clean pinned block vs a cluttered multi-comment scroll), NOT a decimal or name
    // bug. These tests LOCK the parser contract AND the safety gate together (no production change).
    // ─────────────────────────────────────────────────────────────────────────────────────────

    // Every valid leading-decimal jewelry weight stays GRAMS (never Fixed Price). 0.10==0.1, 0.20==0.2.
    @Test
    fun owner_leadingDecimalMatrix_allGrams() {
        assertEquals("0.1", pinnedGrams(".10"))
        assertEquals("0.12", pinnedGrams(".12"))
        assertEquals("0.2", pinnedGrams(".20"))
        assertEquals("0.23", pinnedGrams(".23"))
        assertEquals("0.44", pinnedGrams(".44"))
        assertEquals("0.45", pinnedGrams(".45"))
        assertEquals("0.55", pinnedGrams(".55"))
        assertEquals("0.88", pinnedGrams(".88"))
    }

    // Existing safe grams (whole + non-leading decimals) preserved exactly.
    @Test
    fun owner_regularGrams_preserved() {
        assertEquals("1.21", pinnedGrams("1.21"))
        assertEquals("1.99", pinnedGrams("1.99"))
        assertEquals("3.39", pinnedGrams("3.39"))
        assertEquals("11.9", pinnedGrams("11.9"))
    }

    // Fixed Price forms stay Fixed (value extracted, grams null) — k / comma / >999 never grams.
    @Test
    fun owner_fixedPrice_preserved() {
        listOf("15000", "15,000", "15k").forEach { v ->
            val g = ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line(v, 900)))
            assertEquals(v, g.itemQuery)
            assertNull(g.grams)
        }
    }

    // A leading-decimal claim reads for names of DIFFERENT lengths — a short and a long FB name.
    @Test
    fun owner_leadingDecimal_readsShortAndLongNames() {
        ScreenshotOcr.guessFrom(listOf(line("Gen Gonz", 850), line(".88", 900))).let {
            assertEquals("Gen Gonz", it.fbName); assertEquals("0.88", it.grams)
        }
        ScreenshotOcr.guessFrom(
            listOf(line("Maria Kristina Delos Santos", 850), line(".55", 900)),
        ).let {
            assertEquals("Maria Kristina Delos Santos", it.fbName)
            assertEquals("0.55", it.grams)
        }
    }

    // Robustness: OCR emits the SAME pinned value twice (line-doubling / rapid re-comment). The
    // buyer is still unambiguous (one name, one value) → reads; it does NOT fall to Needs Review.
    @Test
    fun owner_leadingDecimal_duplicateValueLine_stillReads() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("King Gonzales", 820),
                line(".88", 870),
                line(".88", 910), // OCR duplicate of the same pinned value, directly below
            ),
        )
        assertEquals("King Gonzales", g.fbName)
        assertEquals("0.88", g.grams)
    }

    // THE REAL FAILURE (mirrors stored captures ~11:37): the SAME buyer rapid-fires several DIFFERENT
    // weights (.44 / .12) pushed above the pinned band. Two+ distinct concrete values in the recovery
    // area → Needs Review (never auto-pick one). This is the safety behavior the Owner asked to
    // PRESERVE — "Name not read" is correct here, not a decimal parser bug.
    @Test
    fun owner_rapidFireMultipleDecimals_needsReview() {
        val h = 1920
        val g = ScreenshotOcr.guessFrom(
            listOf(
                OLine("King Gonzales", Box(40, 900, 400, 940)),
                OLine(".44", Box(40, 945, 400, 985)),
                OLine("King Gonzales", Box(40, 1000, 400, 1040)),
                OLine(".12", Box(40, 1045, 400, 1085)),
            ),
            minClaimTop = (h * 0.60).toInt(),   // 1152 — pinned band empty (values pushed up)
            recoveryFloor = (h * 0.45).toInt(), // 864
        )
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // 200 Stars stays rejected even directly under a real name (banner number never grams).
    @Test
    fun owner_send200Stars_rejectedUnderName() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("King Gonzales", 850),
                line("Send 200 Stars to pin your comment here.", 900),
            ),
        )
        assertNull(g.grams)
        assertNull(g.itemQuery)
    }
}
