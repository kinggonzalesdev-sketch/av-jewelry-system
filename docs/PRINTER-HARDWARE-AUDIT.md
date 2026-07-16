# Printer Hardware Compatibility Audit (Part C, Phase 3)

**Date:** 2026-07-16 · **Status:** audit only — no direct-Bluetooth claim is made.
**Subject:** the approved label printer for A.V. Jewelry Operations.

This is the audit Part C requires **before** committing to a direct-browser
Bluetooth implementation. Its conclusion governs which implementation path is
allowed. Where a fact could not be confirmed **without the physical device**, it
is marked **UNCONFIRMED** rather than guessed — that is the whole point of the
audit (Bible §27.18; SOT §5: "never claims 'Printer Ready' without a real-device
validation").

---

## 1. Findings

| Item | Finding | Source / confidence |
| --- | --- | --- |
| Target brand | **Xprinter** | Documented (Bible §27.18, `src/lib/labels/transport.ts`). **Confirmed in docs.** |
| Exact model | **XP-236B** | Documented. **Confirmed in docs.** |
| Device class | Thermal **label** printer (not a 58/80 mm receipt printer) | Documented 40×30 mm label use. **Confirmed in docs.** |
| Paper / media | **40 mm × 30 mm labels** (≈ 320 × 240 dots @ 203 dpi) | Bible §5, `renderLabel()`. **Confirmed in docs.** The "58 mm vs 80 mm receipt" question does not apply — this is label media, not receipt roll. |
| Label field priority | claim/reference no. · complete buyer name · mine date & time · item code · grams · total item price · claim position/allocation | Bible R4.6.1. **Confirmed in docs.** |
| Bluetooth type (Classic vs BLE) | **UNCONFIRMED** — decisive, see §2 | Requires the physical unit. |
| Command language | **UNCONFIRMED** — Xprinter label units are typically **TSPL/TSPL2**, some also **ESC/POS**; the XP-236B specifically must be confirmed | Requires the physical unit / vendor SDK. |
| Android + Chrome | Web Bluetooth exists **only if the printer is BLE/GATT** and the page is a secure context | Platform fact + UNCONFIRMED printer BT type. |
| iPhone / Safari | **Not supported at all** — see §2 | **Hard platform fact.** |
| Pairing requirements | **UNCONFIRMED** (Classic SPP typically pairs with a PIN; BLE pairs on connect) | Requires the physical unit. |
| BLE service / characteristic UUIDs | **UNCONFIRMED** — must be read from the device | Requires the physical unit. |
| Browser-based printing supported by the actual device? | **CANNOT be declared supported** — see §3 | Blocked by two facts below. |

## 2. The two decisive facts (independent of the unknowns)

**A. iOS/Safari has no Web Bluetooth — at all.** Apple does not implement the
Web Bluetooth API in Safari or in any iOS browser (all iOS browsers use WebKit).
So **direct in-browser Bluetooth printing is impossible on iPhone/iPad**,
regardless of the printer. Any iOS path must be AirPrint (which thermal label
printers generally do not support) or a manufacturer/native app.

**B. Web Bluetooth is BLE-only; many thermal printers are Bluetooth Classic
(SPP).** The Web Bluetooth API can talk only to **Bluetooth Low Energy (GATT)**
devices. A large share of budget thermal printers expose only **Bluetooth
Classic / SPP**, which a browser **cannot** reach. Whether the XP-236B exposes a
usable BLE GATT service is **UNCONFIRMED** and can only be established by
inspecting the physical unit (e.g. via `chrome://bluetooth-internals` or a BLE
scanner). If it is Classic-only, direct browser printing is **off the table on
every platform**, not just iOS.

## 3. Conclusion & mandated path

**Direct browser Bluetooth printing MUST NOT be enabled now.** Even in the best
case it would work on Chrome/Android **only** (never iOS), and even that depends
on the still-unconfirmed BLE question. Declaring it "working" would be exactly
the overstatement Part C and the SOT forbid.

**Therefore: Path B (fallback) is the correct path today**, with direct
Bluetooth kept behind the existing capability gate (`printer_xp236b_bluetooth`),
which the database already refuses to enable without a recorded passing
real-device validation (Phase 10). This matches the shipped design: `renderLabel`
(pure, done) is separated from `send` (transport), and the `bluetooth` transport
already returns **`unsupported`** — honestly — rather than pretending to print.

## 4. Exact hardware information still required before direct Bluetooth

To lift the gate, a session with the physical XP-236B must record:

1. **Bluetooth type** — Classic (SPP) or BLE (GATT). *(If Classic: direct browser
   printing is impossible; stop here and stay on Path B / a native bridge.)*
2. If BLE: the **GATT service UUID** and the **writable characteristic UUID(s)**
   used for print data (read from the device).
3. **Command language** actually accepted (TSPL2 vs ESC/POS) and the exact byte
   sequences for: init, text, and a 40×30 mm label feed/cut.
4. **Pairing** procedure and any PIN.
5. A **real-device test print** of the approved label on Chrome/Android, recorded
   as a passing validation at `/admin/capabilities`.
6. Confirmation of the **iOS decision** — since browser Bluetooth can never work
   on iOS, whether iOS staff use Android for printing, or a manufacturer app, or
   manual fallback only.

Until items 1–5 exist, **no session may declare direct Bluetooth printing
supported**, and the status control must never show `Printer Ready`.

## 5. What ships in the meantime (real, honest)

- **Render is done** — `renderLabel()` produces the approved 40×30 mm label
  content, device-free and testable.
- **Fallback is real** — `browser_preview` transport returns a genuine printable
  result that a human prints; V1 explicitly launches on this manual path
  (roadmap §35 r10–11; `SESSION-HANDOFF` §6).
- **The gate is real** — the capability stays OFF and the DB refuses to enable it
  without a passing real-device validation.

The UI must clearly distinguish *print file generated* / *sent to system print
dialog* / *successfully transmitted to the printer* / *result unknown*, and must
never claim direct transmission while on the fallback path.
