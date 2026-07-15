# Phase 6 — Owner-Approved Business Decisions

Resolves the items the roadmap marked **"(blocks this phase)"** for Phase 6
(§16.23, §17.28). Approved by the Owner on 2026-07-15. These are the definitive
V1 rules; the implementation encodes exactly what is written here and invents
nothing beyond it.

---

## 1. Paid in Full

An Official Order is **Paid in Full** only when:

```
Total Verified Net Payments  >=  Total Amount Payable
```

**Total Amount Payable** =
Official Order item total

- approved Layaway fee (when applicable)
- any other charge explicitly recorded and approved on the Official Order
  − approved discounts or credits

**Only Verified payments count.** These never count toward Paid in Full:

- evidence that is only submitted
- unverified payments
- rejected evidence
- voided payments
- reversed payments
- pending payment corrections

**Required Payment Verified is not automatically Paid in Full.**

Non-Layaway orders may be marked Paid in Full once verified net payment covers
the full payable amount.

**Layaway Completed** additionally requires:

- Outstanding Balance = ₱0.00
- no unresolved payment correction
- no unresolved overpayment
- every payment used in the calculation is Verified

## 2. Outstanding Balance

```
Outstanding Balance = max(Total Amount Payable − Total Verified Net Payments, 0)
```

**Layaway Amount Payable** =
Official Order item total + approved Layaway fee − approved discounts/credits

Shipping fees and COD balances stay **separate** from the Layaway balance unless
explicitly added as an approved Official Order charge.

Unverified evidence never counts toward the Outstanding Balance.

**An overpayment must never produce a negative Outstanding Balance.** Instead:

- Outstanding Balance: ₱0.00
- Overpayment Credit: the verified excess

Completed Layaway requires Outstanding Balance = ₱0.00.

## 3. Accepted payment methods and required evidence (V1)

| Method                                    | Required                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bank Transfer**                         | amount · date/time · bank or provider · transaction/reference number · proof screenshot or receipt image                                                                                                |
| **GCash / Maya / approved e-wallet**      | amount · date/time · wallet provider · transaction/reference number · proof screenshot                                                                                                                  |
| **Cash (store or authorized collection)** | amount · date/time received · received-by staff · store/collection location · receipt/reference number. Photo evidence **optional**; receiving staff identity and receipt/reference number **required** |
| **Credit / Debit card**                   | amount · date/time · payment channel · approval/reference number · receipt or transaction confirmation                                                                                                  |
| **Other**                                 | Owner or authorized configuration only: method name · amount · date/time · reference number · supporting evidence · reason/note                                                                         |

**NEVER STORED** (card data): full card number · CVV · PIN · any sensitive card
authentication data.

Every submitted payment stays **Unverified** until an authorized user verifies it.
Duplicate transaction/reference numbers are **flagged for review, never silently
accepted**.

## 4. Partial, underpayment, overpayment

**Partial** — allowed; one payment record; only the verified amount reduces the
Outstanding Balance; never auto-marks Paid in Full.

**Underpayment** — accepted as a partial payment once verified; remaining balance
stays visible; the order/Layaway stays unpaid/active; the system must **not**
automatically adjust the expected payable amount.

**Overpayment** — flagged for review; never auto-applied to another order; never
silently changes prices, fees, or balances; verified excess is recorded as
**Overpayment Credit**; refund/credit/reassignment requires the Owner or an
authorized correction workflow.

**V1 prohibitions:** no automatic refund · no automatic transfer to another order
· no automatic customer wallet credit · no silent reassignment.

**Payment Correction** — an _unverified_ payment may be corrected by an authorized
staff member; correcting a _verified_ payment **requires Owner approval**.
Original values remain auditable; financial history is never silently overwritten.

## 5. Layaway fee and rounding

```
Layaway Fee = ₱150 × Total Layaway Grams × Number of Layaway Months
```

**Total Layaway Grams** = Σ (grams per piece × quantity) across all item lines in
the same Layaway Official Order.

The fee applies **once to the entire Layaway Official Order** — not per item line.

_Worked examples (encoded as tests):_

- One item: 2.5 g × 1 × 2 months × ₱150 = **₱750.00**
- Multi-item: A = 2 g × 1, B = 1.5 g × 2 → 5 g total; 5 × 3 × ₱150 = **₱2,250.00**

**Rounding:**

- store money as exact decimals, **never floating point**
- round the **final** fee to 2 dp, standard **half-up** currency rounding
- do **not** round grams before calculating
- preserve recorded item grams at their approved database precision
- do **not** repeatedly round intermediate calculations

**Term:** minimum 1 month, maximum 3 months. Changing the term after activation
requires an authorized correction and audit. No automatic fee recalculation after
activation unless an approved correction executes.

## 6. Activation and completion

Layaway becomes **Active** only after all of:

- the Official Order exists
- the Layaway arrangement is approved
- **verified** down payment ≥ 20% of the Layaway Amount Payable

```
Required Down Payment = 20% of Layaway Amount Payable   (fee included)
```

Evidence submission alone never activates Layaway.

**Maximum duration:** 3 months. **Maximum grace:** 10 calendar days after the
final due date. Grace adds **no** extra month and **no** extra fee.

After grace:

```
Forfeiture Eligible → Forfeiture Review → Owner Approval
                    → Execute Forfeiture → Returned-to-Stock Review
```

**No automatic forfeiture. No automatic stock return.**
