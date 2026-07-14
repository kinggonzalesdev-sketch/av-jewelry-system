# A.V. Jewelry Operations System — Development Bible

> **Internal Project Name:** MineFlow
> **Client-Facing System Name:** A.V. Jewelry Operations System
> **Document Type:** Single Source of Truth (Development Bible)
> **Status:** In Progress — Sections 1–18 APPROVED; Section 19 (Inventory Workflow) pending

---

## Section 1 — Project Vision

### 1.1 Vision Statement

A.V. Jewelry Operations System (internally, **MineFlow**) is a custom internal web application that unifies A.V. Jewelry's entire live-selling operation into one fast, organized, secure, and reliable system.

It exists to replace the paper notes, spreadsheets, and manual routines the business depends on today with a single workflow-driven platform — one that follows every order from the moment a buyer mines an item during a Facebook Live sale through to payment, preparation, shipping or pickup, and completion, without a detail being lost along the way.

The system is built around how A.V. Jewelry already works. It does not ask the business to change a proven operational process; it removes the manual friction inside that process.

### 1.2 Purpose

A.V. Jewelry Operations System exists to **centralize and simplify A.V. Jewelry's live-selling operations by replacing manual, paper-based, and spreadsheet-driven processes with one fast, organized, secure, and reliable web application.**

Concretely, the system's purpose is to:

- Capture live-selling claims quickly and accurately through a staff-assisted workflow, with automation introduced only where integrations have been verified.
- Give every order a single, traceable record from first mine to final outcome.
- Turn invoicing, payment verification, and layaway monitoring into structured, repeatable steps instead of manual after-the-fact work.
- Reduce staff workload, duplicate encoding, and human error as order volume rises.
- Give the Owner one current and consolidated view of orders, payments, reminders, layaway accounts, inventory, and shipments based on the latest data recorded in the system.

### 1.3 Problem Statement

Today, A.V. Jewelry runs its live-selling operation almost entirely by hand. The business relies on paper notes, Excel monitoring, manual invoicing, manual payment verification, manual order tracking, and manual customer follow-ups.

As Facebook Live selling activity and order volume increase, the limitations of the manual process become more visible. The workflow can become slow, inconsistent, difficult to trace, and prone to human error. As orders arrive faster than they can be written down and reconciled, the consequences fall directly on customers and staff:

- **Delayed customer assistance** during and after live sales.
- **Missed or unrecorded payments**, because verification is manual and untracked.
- **Forgotten follow-ups**, because reminders live in someone's memory or on a note.
- **Delayed invoices**, often completed the following day instead of within minutes.
- **Lost order details**, when notes are scattered or a handoff between staff fails.
- **Higher staff workload**, from re-typing the same information across tools.
- **Customer complaints**, caused by slow or incomplete assistance.

The root problem is not the people — it is that a growing, fast-moving live-selling business is being run on tools that were never designed to keep pace with it. Every manual step is a place where an order, a payment, or a promise to a customer can slip through.

### 1.4 Primary Users

The system serves **the A.V. Jewelry Owner and approximately 15 staff members**, each performing specific operational duties.

**The Owner** is the single full administrator. The Owner creates each staff account individually and assigns permissions based on that person's duties. There are **no shared staff login credentials** — every staff member has their own account, which is the foundation for accountability and traceable handoffs throughout the system.

**Staff roles** correspond to the real duties on the floor, including:

- Live Selling Assistance
- Invoice Processing
- Payment Verification
- Layaway Monitoring
- Inventory
- Shipping and Pickup
- Customer Support
- Posting
- Remittance
- Walk-in Assistance
- Scrap Buying and Appraisal Assistance

The system must remain **simple enough for non-technical staff to operate on mobile phones**, since much of this work happens live and on the move rather than at a desk.

### 1.5 Operational Scope

**Version 1** is built for **one jewelry business operating under one main Facebook Page.**

Within that boundary, the system covers the full live-selling operation end to end:

- Capturing live-selling claims through a staff-assisted workflow, then reviewing, matching, and confirming them before creating official order records.
- Tracking each order through its complete lifecycle — mined, invoiced, paid, prepared, shipped or picked up, completed, cancelled, or placed on layaway.
- Invoicing, payment verification, and remittance.
- Layaway account monitoring.
- Shipping and pickup follow-up.
- Inventory.
- Support for relevant staff duties and handoffs, including customer support, remittance, walk-in transactions, posting-related coordination, and scrap buying or appraisal records, only where these are confirmed as part of the V1 operational workflow.
- Reporting and a unified Owner dashboard.

**A Facebook mine or claim is not automatically treated as a completed or confirmed order.** It must first be captured, reviewed, matched to the correct item or stock allocation, and confirmed by authorized staff before it becomes an official order record. The exact status names and transitions are intentionally not finalized here — they are defined later in the **Complete Order Lifecycle** and **Status Transition Rules** sections.

**The business does not currently use Pancake.** **Pancake** will be introduced as a **planned integration** to help connect the Facebook Page, receive available customer interaction data, support the live-selling workflow, and assist with messages or reminders where its verified API capabilities allow.

> **Important — to be verified, not assumed:** It must **not** be assumed that Pancake can automatically provide all Facebook Live comments, customer identities, timestamps, or outbound messaging. These capabilities will be confirmed later against official documentation and actual testing before any part of the system depends on them.

### 1.6 Success Outcomes

Six months after launch, the system will be considered successful when:

- **Live-selling orders are captured and processed significantly faster** than the current manual process allows.
- **Every captured claim and confirmed order is traceable** through its appropriate lifecycle, from initial capture and staff confirmation through payment, preparation, shipping, pickup, completion, cancellation, or layaway.
- **Invoice creation takes minutes**, not a manual task completed the following day.
- **Payment verification is organized, traceable, and far less prone to missed entries.**
- **Layaway monitoring is structured and partly automated.**
- **Staff workload is measurably reduced.**
- **Customer complaints caused by delayed or incomplete assistance are significantly reduced.**
- **The risk of orders being lost** because of paper notes, forgotten follow-ups, or scattered records is materially reduced, and every confirmed order has a traceable system record.
- **Staff can quickly find any order** by customer name, Facebook name, order number, item code, or shipping number.
- **The Owner can see the current state of the whole operation** — orders, payments, reminders, layaway accounts, inventory, and shipments — from a single dashboard.

> **Note on measurement:** Terms such as *"faster," "reduced,"* and *"significantly reduced"* above describe the intended direction of improvement, not fixed guarantees. Exact baseline measurements, target percentages, and service-time goals will be established later in the **Reporting & Analytics** and **Testing** sections, after the current workflow is documented and observed.

### 1.7 Design Principles

The system is guided by one core philosophy: **it must adapt to the existing business workflow instead of forcing the business to change its proven operational process.** Technology should simplify the staff's work while preserving the operational practices that already make A.V. Jewelry successful.

From that philosophy, the system must:

- **Reduce manual work** at every step of the live-selling operation.
- **Reduce errors** in orders, payments, and follow-ups.
- **Eliminate duplicate encoding** — information is entered once and reused.
- **Improve accountability** — individual accounts make every action attributable.
- **Make staff handoffs easier** — an order's full context travels with it.
- **Make order and payment history traceable** — nothing depends on memory.
- **Stay simple enough for non-technical staff to use on mobile phones.**

### 1.8 Scope Boundaries

To keep Version 1 focused and deliverable, the following boundaries apply:

- **This is a custom, single-client, multi-user web application — not a public SaaS platform.** There is one business, one main Owner account, and multiple staff accounts with custom permissions.
- **This is not a public e-commerce storefront.** It is an internal operations tool for staff and the Owner.
- **Version 1 covers one business and one primary Facebook Page.** Additional pages, brands, or businesses are out of scope for V1.
- **This system is not replacing an existing software platform.** It is the first fully integrated internal operations system built specifically around A.V. Jewelry's real business workflow; there is no legacy application to migrate from — only the current manual process to absorb.
- **Pancake's exact capabilities are not assumed.** Any workflow that depends on Pancake data or messaging is provisional until verified against official documentation and live testing.
- **The developer is responsible for development and maintenance but is not the business Owner or primary system administrator.** Administrative control of the live system rests with the Owner.

### 1.9 Future Direction

Version 1 deliberately concentrates on one business and one Facebook Page so the core operation is solid before the system grows. Once that foundation is proven, future versions may expand along these lines:

- **Additional selling channels** such as Instagram, TikTok, Shopee, and other platforms.
- **Deeper Pancake integration**, expanded only as far as its verified API capabilities genuinely allow.
- **Broader automation** of reminders, follow-ups, and layaway monitoring as real usage reveals where it delivers the most value.

These directions are noted here to shape early technical decisions so the system can grow without being rebuilt — but they remain **out of scope for Version 1**.

These future possibilities must not introduce unnecessary complexity into Version 1. The V1 architecture should remain clean and extensible, but it should not be over-engineered for unconfirmed future channels.

---

### System Identity Reference

| Attribute | Value |
|---|---|
| Client-Facing Name | A.V. Jewelry Operations System |
| Internal Project Name | MineFlow |
| Footer Text | Powered by King GenZ Digital |
| Version Focus | V1 — one business, one primary Facebook Page |
| Full Administrator | Owner (single) |
| Staff Accounts | ~15, individual credentials, permission-based |

---

*End of Section 1 — Project Vision. **APPROVED.** Section 2 — Business Workflow follows.*

---

## Section 2 — Business Workflow

### 2.1 Purpose of the Business Workflow Section

This section documents how A.V. Jewelry's live-selling operation works, in two clearly separated views:

1. **The current manual workflow** — how the business operates today, using Facebook Live, comments, screenshots, paper notes, manual encoding, and Excel.
2. **The planned Version 1 (MineFlow) workflow** — the approved system-supported process that will replace the manual routine.

The purpose is to give every stakeholder a shared, accurate understanding of the operation before any screens, modules, or technical design are defined. Later sections (Complete Order Lifecycle, Status Transition Rules, and the individual workflow sections) build on the foundation established here.

**This section observes four strict boundaries:**

- The **current manual workflow** is described only from confirmed information. Where a current detail has not been confirmed, it is marked **"To be confirmed with the client."**
- The **planned V1 workflow** is presented as approved design direction — never as something the client already does today.
- **Provisional items** are not treated as final business rules.
- **Open client questions** are listed as questions, not answered by assumption.

This section stays operational and business-focused. It does not discuss database design, APIs, code, hosting, or technical architecture; those are covered in later sections.

### 2.2 Current Manual Workflow Overview

Today, A.V. Jewelry sells jewelry through **Facebook Live**. Customers primarily claim items using the format **`MINE + GRAMS`** (for example, `MINE 2.5G`). Jewelry pricing commonly uses the item's **weight in grams** and a **price per gram**.

The entire operation is currently run **manually**. Claims and customer information are handled using Facebook Live comments, screenshots, paper notes, manual encoding, and Excel where applicable. Invoicing, payment verification, follow-ups, order monitoring, layaway monitoring, shipping monitoring, and inventory monitoring are all performed manually as well.

The business **does not currently use Pancake**. Pancake is a **planned, unverified integration** discussed in later sections; it is not part of the current workflow, and no part of the current process depends on it.

> **Note:** Several specific details of the current process — such as the exact pre-Live preparation steps, staff assignments during a Live, invoice layout, paper-note contents, and Excel file structure — have not yet been confirmed. These are marked **"To be confirmed with the client"** throughout this section and are consolidated in **2.9 Open Client Questions**.

### 2.3 Current End-to-End Manual Process

The following describes the current manual process stage by stage. Only confirmed information is stated as fact; unconfirmed details are explicitly flagged.

**Before the Live**
The team prepares the jewelry items to be presented and assigns staff to assist with the Live. *The exact preparation steps — who selects items, who weighs them, who checks pricing, and who prepares item codes — is To be confirmed with the client. The number of staff working a Live, their assignments, and who hosts is also To be confirmed with the client.*

**Customer Mine or Claim**
During the Live, customers claim an item by commenting in the **`MINE + GRAMS`** format. Because different items may share the same weight, staff must take care that a claim is matched to the intended item. *The full set of accepted claim formats, and how a customer identifies a specific item when weights collide, is To be confirmed with the client.*

**Manual Claim Recording**
Claims and customer information are recorded manually. Staff rely on Facebook Live comments, screenshots, paper notes, manual encoding, and Excel where applicable to capture details such as the customer's Facebook name, the mine comment, the grams claimed, and item information. *The exact recording method and which details are consistently captured is To be confirmed with the client.*

**Item and Customer Matching**
Staff match each claim to a customer and to the intended jewelry item, including its grams and price. *The exact method used today to determine claim order (first, second, third claimant) and to match a claim to the correct item is To be confirmed with the client.*

**Invoice Preparation**
Invoices are prepared **manually** after claims and order details are reviewed. This can involve manual encoding and preparation after the Live, sometimes on the following day. *The exact invoice layout, the required fields, and how the invoice is delivered to the customer is To be confirmed with the client.*

**Payment Submission and Verification**
Customers submit payment and proof of payment through available channels. Staff verify payments manually against available records. *The exact current payment-verification procedure, and where verified payments are recorded, is To be confirmed with the client.*

**Unpaid Follow-ups**
Unpaid orders and reminders are tracked **manually**. *The exact current method for identifying who has not paid, and how and when unpaid customers are followed up, is To be confirmed with the client.*

**Layaway Monitoring**
Layaway arrangements and their payments are monitored **manually**. *The exact current layaway terms, tracking method, and handling of missed payments is To be confirmed with the client.*

**Preparation**
After payment, orders are prepared for release. *The exact packaging and quality-control steps are To be confirmed with the client.*

**Shipping or Pickup**
Orders are fulfilled by shipping or by store pickup. *The exact couriers used, courier-specific steps, and the pickup-verification method are To be confirmed with the client.*

**Completion or Cancellation**
Orders are completed once fulfilled, or cancelled for various reasons. *The exact current cancellation rules and who authorizes them is To be confirmed with the client.*

**Inventory Monitoring**
Inventory is tracked **manually** through available records, paper notes, and Excel where applicable. *The exact inventory files, counting process, and reconciliation routine is To be confirmed with the client.*

**Staff Handoffs**
Work passes between staff at different stages. Handoffs today may rely on paper notes, verbal communication, Messenger or group chats, and Excel records. *The exact current handoff process is To be confirmed with the client.*

**Paper Notes and Excel Usage**
Paper notes are used during or after live selling to record customer and order information, and Excel is used for manual monitoring. *The exact fields written on paper notes, and the number, purpose, columns, and owners of the Excel files, is To be confirmed with the client.*

**Simple Text Diagram — Current Manual Process**

```
FACEBOOK LIVE
   │
   ▼
Customer comments "MINE + GRAMS"
   │
   ▼
Staff capture claim manually
(comments / screenshots / paper notes / Excel)
   │
   ▼
Match customer + item + grams + price   ── mistakes possible ──┐
   │                                                           │
   ▼                                                           │
Prepare invoice manually (sometimes next day)                 │
   │                                                           │
   ▼                                                           │
Customer pays + sends proof                                   │
   │                                                           │
   ▼                                                           │
Staff verify payment manually                                 │
   │                                                           │
   ├── if unpaid ──► Manual follow-up (paper / chat) ──────────┤
   │                                                           │
   ▼                                                           │
Prepare order ─► Ship or Pickup ─► Complete                   │
   │                                                           │
   ▼                                                           │
Update inventory manually  ◄───────────────────────────────────┘
(paper / Excel, at a To-be-confirmed point)
```

*The dashed paths indicate where information is re-handled manually and where errors or losses can occur under the current process.*

### 2.4 Current Workflow Pain and Risk Points

The manual process carries recognized risks. As Facebook Live activity and order volume increase, the limitations of the manual approach become more visible. The following pain and risk points are drawn from the confirmed problem statement (Section 1) and the confirmed manual nature of the current process:

| Area | Pain / Risk |
|---|---|
| Claim capture | Claims may be missed, duplicated, or recorded inconsistently across comments, screenshots, paper, and Excel. |
| Item matching | Items sharing the same grams can be matched incorrectly without a reliable unique identifier. |
| Miner order | Determining who claimed first, second, or third relies on manual observation and can be disputed. |
| Invoicing | Manual invoicing can be delayed, sometimes to the following day. |
| Payments | Manual verification is prone to missed or unrecorded payments. |
| Follow-ups | Reminders depend on memory or notes and can be forgotten. |
| Handoffs | Passing work between staff via paper, chat, or verbal messages can drop details. |
| Records | Order, payment, and inventory information is scattered across paper and Excel, making history hard to trace. |
| Duplicate encoding | The same information is often re-entered at several stages, increasing workload and error. |

*The exact frequency of these issues has not been measured. Baseline measurements will be established later in the Reporting & Analytics and Testing sections.*

### 2.5 Planned Version 1 Workflow Overview

Version 1 (MineFlow) replaces the manual routine with a **staff-assisted, workflow-driven system**. The planned system keeps the operational practices that already work while removing manual friction, reducing duplicate encoding, and making every confirmed order traceable.

Two principles anchor the planned workflow:

1. **A customer mine or claim is not automatically an official order.** Every claim must be captured, reviewed, matched, and confirmed by authorized staff before it becomes an official order record.
2. **Automation is only introduced where an integration is verified.** The system does **not** assume automatic Facebook comment capture, automatic messaging, or real-time synchronization. Pancake remains a **planned, unverified integration** and no planned workflow depends on it until its capabilities are confirmed through official documentation and testing.

The planned access model is also part of V1 (not the current workflow): the **Owner is the only full administrator**, and **staff use individual accounts with permission-based access**.

> **Note on status names:** This section refers to workflow stages in plain operational language. Exact, final status names and their allowed transitions are intentionally **not** finalized here — they are defined later in the **Complete Order Lifecycle** and **Status Transition Rules** sections.

### 2.6 Planned End-to-End Version 1 Workflow

The following describes the approved V1 process stage by stage. These are **planned system behaviors**, not descriptions of current practice.

**Pre-Live Preparation**
Staff prepare the items and assignments for the Live within the system. *The exact preparation steps and whether every item receives a code before the Live remain To be confirmed with the client; the system should accommodate the confirmed process once defined.*

**Staff-Assisted Claim Capture**
As customers claim items during the Live, authorized staff capture each claim through a staff-assisted workflow. A screenshot or available customer-interaction reference may assist staff in recording the customer's Facebook name, the mine comment, the comment timestamp where available, the grams or item code, the item details, the price, and the claim/miner position. The system does **not** assume Facebook or Pancake will automatically supply this information.

**Claim Review and Miner Position**
Authorized staff review captured claims. For a **unique item**, the system supports up to **three miner positions** — first, second, and third — where the second and third miners act as **backups**. The order reflects the valid sequence of customer claims as observed or verified by authorized staff; timestamps or integration data may assist **only where reliable and verified**. Staff can review and confirm the miner order before it becomes final. If a claim is withdrawn before Confirm and Print (see **Claim Withdrawal, Switching, and Correction** below), the system identifies the next eligible miner and proposes the updated miner positions; authorized staff review and confirm the promotion before it becomes final. *The exact method for determining first, second, and third miner remains To be confirmed with the client.*

**Item Matching and Stock Allocation**
Staff match the claim to the correct customer, jewelry item, item code, grams, price per gram, computed price, size (where applicable), and available stock or specific unique piece, correcting missing details before confirmation. For **multiple-stock items**, available quantity is allocated to valid miners first, with excess claims placed on a **waiting list** where appropriate. A claim must not become an official order until the item and stock allocation are verified.

**Claim Withdrawal, Switching, and Correction (Before Confirm and Print)**
Because a claim that has not passed Confirm and Print is **not** an official order, changes at this stage are handled as claim actions — not order cancellations.

*Withdraw Claim.* Authorized staff may withdraw a captured claim using one of these reasons: **Mistaken Mine, Changed Mind, Switching to Another Item, Duplicate Claim, Wrong Item or Grams Entered, Customer Requested Withdrawal, Invalid Claim,** or **Other** (which requires a staff note). When a claim is withdrawn, the system must retain the original claim in the history, mark it as **Withdrawn**, record the reason, record the staff member with date and time, release the item or stock allocation, create an audit-log entry, and identify the next eligible miner and propose the updated miner positions (second miner to first, third miner to second, where applicable), which authorized staff review and confirm before they become final. **The original claim must not be permanently deleted.**

*Switch Item.* When a customer wants to replace the original mined item with another item, staff withdraw the original claim using **Switching to Another Item**, release the original item to the next valid miner or available stock, and then create a **separate new claim** for the replacement item, which is reviewed and confirmed independently. A claim is **not** transferred directly to a different item, so that each claim keeps a clear audit trail.

*Edit Claim.* If the customer selected the correct item but staff encoded the wrong grams, item code, price, or customer details, authorized staff may use **Edit Claim** before Confirm and Print. Every edit must record the previous value, the new value, the reason for correction, the staff member, and the date and time.

*Planned claim-screen actions.* The planned claim screen should support **Edit Claim**, **Withdraw Claim**, **Switch Item**, and **Confirm and Print**. *The staff permission(s) governing Edit Claim, Withdraw Claim, and Switch Item remain To be confirmed with the client.*

**Confirm and Print**
When an authorized user selects **Confirm and Print**, the reviewed claim is confirmed. Only the **Owner or a staff member with the specific Confirm Order permission** may confirm. The customer does not perform a separate system login to confirm. *Whether a Messenger acknowledgment is required as part of confirmation remains To be confirmed with the client.*

**Official Order Creation**
At the point of Confirm and Print, the claim becomes an **official order record**. The system is planned to:

- generate an order number,
- reserve or allocate the specific item or quantity,
- save the customer and item details,
- create an audit-log entry,
- add the order to the correct dashboard workflow, and
- send the label job to the print queue.

**Invoice Workflow**
Assigned invoicing staff prepare the invoice from the confirmed order, with the goal of making it available **within minutes** of confirmation rather than the following day. The planned invoice may include the order number, customer/Facebook name, item details, item code, grams, price per gram, total amount, payment method, payment instructions, due date or reservation deadline, layaway details where applicable, and shipping or pickup information where applicable. *The exact invoice layout, the final field list, and the delivery method (expected to be Messenger) remain To be confirmed with the client.*

**Unverified Payment Workflow**
When a customer submits payment and proof, the payment first enters an **Unverified Payment** state. A submitted payment is **never** automatically treated as verified. Planned payment records may include the payment method, amount, reference number, proof-of-payment image, date, time, customer name, related order or invoice, and staff notes.

**Payment Verification**
Assigned payment-verification staff review the submitted proof and match it against the customer, order or invoice, amount due, payment method, reference number, date and time, and available payment records. The payment is marked **verified only by an authorized staff member**. *The exact verification procedure and the final list of supported payment methods (including whether BDO, BPI, credit/debit card, COD, and COP are all required in V1) remain To be confirmed with the client.*

**Reminder Workflow**
Unpaid orders are supported by a reminder workflow that records every reminder attempt, including reminder history, count, date and time, the staff member involved, the next follow-up date, and customer response notes. In **Version 1, reminders are staff-triggered**; the system records each attempt. The planned default cadence for unpaid orders is **Day 1, Day 2, and Day 3 (final)**. The default item hold period is **24 hours**, with a **one-day extension** allowed on authorization; if the first miner does not complete in time, the item may move to the second, then the third miner. Automatic sending will be added **only where the messaging integration is verified**. *The exact customer-facing reminder wording, and the destination after the third miner declines or expires, remain To be confirmed with the client.*

**Layaway Workflow**
The planned layaway rules are: minimum down payment **20%**, maximum period **3 months**, and layaway fee **₱150 × item grams × number of months**. The system is planned to calculate the down payment, remaining balance, layaway fee, due dates, installment schedule, total amount, payment history, and overdue status. Planned layaway reminders are **3 days before the due date, on the due date, 5 days overdue, and 10 days overdue (final)**. A **10-day grace period** follows the due date; after grace, an account becomes **eligible** for forfeiture, but the system **never automatically forfeits** — forfeiture requires an authorized staff or Owner action. *The final layaway cancellation and forfeiture policy remains To be confirmed with the client.*

**Preparation Workflow**
After payment is verified, the order moves into preparation, where the item is prepared and checked before release. *The exact packaging and quality-control steps remain To be confirmed with the client.*

**Shipping and Pickup Workflow**
For shipping, the system is planned to record the courier, shipping date, shipping or tracking number, shipping fee, receiver information, proof of shipment where applicable, the staff who processed it, and the date and time the customer was notified; tracking information may be sent through Messenger. For pickup, the system is planned to record the scheduled pickup date, customer name, order number, person receiving the item, confirmation or proof of release, the releasing staff, and the completion date and time. *The exact couriers, courier-specific workflow, and pickup-verification method remain To be confirmed with the client.*

**Completion and Cancellation**
An order is completed after the item has been successfully shipped, released for pickup, or otherwise fulfilled and confirmed. Possible cancellation reasons may include non-payment within the allowed period, voluntary cancellation before a non-cancellable payment or deposit, item or stock issues, duplicate orders, invalid claims, staff correction, or Owner-authorized cancellation. *The exact cancellation rules and permissions remain To be confirmed with the client.*

**Withdraw Claim vs. Cancel Order (important distinction).** Cancellation applies only to an **official order** created by Confirm and Print. Before that point, there is no order to cancel — a customer who changes their mind, mistakenly mines, or wants a different item is handled by **Withdraw Claim** (see above), not Cancel Order. Once Confirm and Print has created the official order, **Withdraw Claim is no longer available**, and any reversal must follow the official Order Cancellation workflow, with the appropriate cancellation reason, permission, inventory release, and audit log.

**Inventory Reservation and Release**
A claim alone does **not** permanently remove an item from inventory. While a claim is open, it holds a miner position and any tentative allocation; if the claim is **withdrawn before Confirm and Print**, that allocation is released to the next valid miner or to available stock, and no order is created. After authorized staff confirmation, the specific item or available quantity is **reserved**. After successful payment and fulfillment, the inventory record is finalized as **sold or released**. If an order expires or is cancelled, the reserved item may return to available stock or move to the next valid miner. The system must support both **one-of-a-kind pieces** and **multiple identical pieces under one item or product code**.

**Staff Handoffs and Accountability**
In the planned system, handoffs occur through dashboard statuses, assigned or responsible staff, staff notes, an activity timeline, notifications, audit logs, and clear next-action indicators — rather than paper notes and verbal messages. Because every staff member uses an individual account, actions are attributable, supporting accountability and traceable handoffs. *The assignment of named staff members and the number of staff per stage remains To be confirmed with the client.*

**Simple Text Diagram — Planned Version 1 Process**

```
FACEBOOK LIVE  (Pancake = planned, unverified; not required)
   │
   ▼
Customer claims "MINE + GRAMS"
   │
   ▼
STAFF-ASSISTED CLAIM CAPTURE
(FB name, comment, grams/code, item, price, miner position)
   │
   ▼
CLAIM REVIEW  ──►  Miner position (1st / 2nd / 3rd for unique item)
   │
   ▼
ITEM MATCH + STOCK ALLOCATION  (unique piece OR multi-stock / waiting list)
   │
   ▼
CLAIM-SCREEN ACTIONS (before Confirm and Print):
[ Edit Claim ] [ Withdraw Claim ] [ Switch Item ] [ Confirm and Print ]
   │
   ├─ Withdraw Claim ─► mark WITHDRAWN (kept in history) • record reason +
   │                    staff + time • release allocation • audit log •
   │                    propose 2nd►1st, 3rd►2nd — staff review + confirm
   │                    before final; next eligible claimant fills open slot
   ├─ Switch Item ────► withdraw original ("Switching to Another Item") +
   │                    create a SEPARATE new claim (no direct transfer)
   ├─ Edit Claim ─────► log previous value → new value + reason + staff + time
   │
   ▼
        ┌───────────────────────────────────────────────┐
        │   Is the claim reviewed and verified by an    │
        │   authorized staff member?                    │
        └───────────────────────────────────────────────┘
                 │ NO ─► stays a CLAIM (not an order); may be Withdrawn
                 │ YES
                 ▼
        CONFIRM AND PRINT  (Owner / Confirm-Order permission only)
        ── after this point: Withdraw Claim unavailable ►
           reversal = Order Cancellation workflow ──
                 │
                 ▼
   ★ OFFICIAL ORDER CREATED ★
   (order number • item reserved • details saved •
    audit log • dashboard workflow • label to print queue)
                 │
                 ▼
   INVOICE  ──►  UNVERIFIED PAYMENT  ──►  PAYMENT VERIFICATION (authorized staff)
                 │                              │
                 │ if unpaid                    ▼
                 ▼                        PREPARATION
        REMINDER WORKFLOW                       │
     (Day 1 / Day 2 / Day 3, staff-             ▼
      triggered; logged; 24h hold +      SHIPPING or PICKUP
      1-day authorized extension)               │
                 │                              ▼
      (1st ► 2nd ► 3rd miner)             COMPLETED
                                                │
                          ┌─────────────────────┘
                          ▼
                  INVENTORY: reserve on confirm →
                  sold/released on fulfillment →
                  return to stock / next miner on expiry or cancel

   LAYAWAY (parallel track): 20% down • max 3 months •
   fee ₱150 × grams × months • reminders (3 days before / due /
   5 days over / 10 days over) • 10-day grace • no auto-forfeiture
```

*The decision gate makes the core rule explicit: a mine or claim only becomes an official order after authorized staff review and Confirm and Print.*

### 2.7 Current Workflow vs Planned V1 Comparison

| Stage | Current Manual Workflow | Planned Version 1 Workflow |
|---|---|---|
| Claim capture | Comments, screenshots, paper notes, Excel | Staff-assisted capture into the system |
| Claim status | Informally treated as an order | Explicitly a claim until confirmed |
| Claim withdrawal / change | Current method for handling mistaken, withdrawn, or changed claims is To be confirmed with the client. | Withdraw Claim / Switch Item / Edit Claim (pre-confirm), logged with reason + audit trail |
| Miner order | Handled manually; the exact current method for determining miner order is To be confirmed with the client. | Up to 3 positions, staff-reviewed; system-assisted promotion subject to staff review on withdrawal (unique items) |
| Item matching | Manual, error-prone with shared grams | Staff match with item code + stock allocation |
| Becoming an order | No clear system moment | Confirm and Print creates the official order |
| Order number | Manual or none | Generated on confirmation |
| Invoicing | Manual, sometimes next day | Prepared from the order, target within minutes |
| Payment | Verified manually | Unverified Payment → authorized verification |
| Follow-ups | Memory, paper, chat | Logged reminder workflow (staff-triggered in V1) |
| Layaway | Manual monitoring | System calculation + reminders (rules provisional) |
| Fulfillment | Manual shipping/pickup notes | Recorded shipping/pickup with responsible staff |
| Inventory | Manual, scattered | Reserve on confirm, release on fulfillment |
| Handoffs | Paper, verbal, chat | Dashboard statuses, notes, timeline, audit logs |
| Accountability | Hard to trace | Individual accounts + audit logs |
| Pancake | Not used | Planned, unverified integration only |

### 2.8 Confirmed Rules, Planned Rules, and Provisional Rules

This subsection restates the approved four-category classification that governs Section 2. It is the source of truth for what is fact, what is approved design, and what is not yet final.

**A. Confirmed Current Workflow**

- The business sells jewelry through Facebook Live.
- Customers primarily claim items using `MINE + GRAMS`.
- Jewelry pricing commonly uses item grams and price per gram.
- Claims and customer information are currently handled manually using Facebook comments, screenshots, paper notes, manual encoding, and Excel where applicable.
- Invoices, payment verification, follow-ups, order monitoring, layaway monitoring, shipping monitoring, and inventory monitoring are currently handled manually.
- The business does not currently use Pancake.

**B. Approved Planned V1 Rules**

- The Owner will be the only full administrator.
- Staff will use individual accounts with permission-based access.
- Staff-assisted claim capture.
- A mine or claim does not automatically become an official order.
- Claim review and confirmation workflow.
- Confirm and Print is the point where an official order record is created.
- Order-number generation.
- Item reservation or stock allocation.
- Audit-log creation.
- Label-print queue.
- Maximum of three miner positions for a unique item.
- Second and third miners as backups.
- Multi-stock allocation and waiting-list support.
- Withdraw Claim for pre-confirmation claims, with defined reasons (Mistaken Mine, Changed Mind, Switching to Another Item, Duplicate Claim, Wrong Item or Grams Entered, Customer Requested Withdrawal, Invalid Claim, Other + required note).
- Withdrawn claims are retained in history and never permanently deleted; withdrawal records the reason, staff, date/time, releases the allocation, writes an audit log, and proposes updated miner positions (2nd→1st, 3rd→2nd) that authorized staff review and confirm before they become final (system-assisted promotion subject to staff review).
- Switch Item creates a separate, independently confirmed new claim; a claim is never transferred directly to a different item.
- Edit Claim before Confirm and Print, recording previous value, new value, reason, staff, and date/time.
- Withdraw Claim is unavailable after Confirm and Print; any reversal then follows the official Order Cancellation workflow.
- Planned claim-screen actions: Edit Claim, Withdraw Claim, Switch Item, and Confirm and Print.
- 24-hour default hold period.
- One-day authorized extension.
- Day 1, Day 2, and Day 3 unpaid reminders (staff-triggered in V1).
- Unverified Payment workflow.
- Authorized payment verification.
- Layaway calculation and monitoring rules.
- 10-day grace period.
- No automatic forfeiture.
- Planned dashboard statuses.
- Inventory reservation and release logic.
- 40 mm × 30 mm label support.
- Planned system handoffs, notes, timelines, notifications, and audit logs.

**C. Provisional Items That Still Require Validation**

- Exact accepted mine formats.
- Whether every item has a code before the Live.
- Exact method for determining first, second, and third miner.
- Exact invoice layout and fields.
- Exact payment-verification procedure.
- Final supported payment methods, including whether BDO, BPI, credit/debit card, COD, and COP are all required in Version 1, must be confirmed with the client.
- Exact customer-facing reminder wording.
- Exact cancellation rules.
- Final layaway cancellation and forfeiture policy.
- Destination after the third miner declines or expires.
- Exact packaging and quality-control steps.
- Exact pickup-verification method.
- Final label fields.
- Exact couriers and courier-specific workflow.
- Whether Messenger acknowledgment is required.
- Any additional product charges beyond grams × price per gram. *(Note: price = grams × price per gram is the primary planned calculation model based on the information provided, not necessarily the only final pricing rule for all products.)*

### 2.9 Open Client Questions Affecting the Workflow

The following questions must be answered in the client workflow interview. They are not answered here, and no answer is assumed.

1. Exact pre-Live preparation process (who selects items, weighs, checks pricing, prepares codes).
2. Exact staff count and assignments during a Live, and who hosts.
3. Whether all items currently receive codes before the Live.
4. Exact current method for establishing first, second, and third miner order.
5. Exact invoice layout and required fields.
6. Exact current payment-verification procedure and where verified payments are recorded.
7. Exact contents and fields of current paper notes.
8. Number, purpose, columns, and owners of current Excel files.
9. Exact packaging and quality-check workflow.
10. Exact pickup verification and release process.
11. Exact client-approved cancellation and forfeiture policies (and permissions).
12. Exact responsibilities of each named staff member (and staff-per-stage counts).
13. Final accepted mine formats and how code-based mines are entered when grams collide.
14. Destination rule after the third miner declines or expires.
15. Whether Messenger customer acknowledgment is a required confirmation step.
16. Which staff permission(s) govern Edit Claim, Withdraw Claim, and Switch Item before Confirm and Print (and whether they differ from the Confirm Order permission).

### 2.10 Section 2 Summary

- A.V. Jewelry currently runs a fully **manual** live-selling operation on Facebook Live, using `MINE + GRAMS` claims, comments, screenshots, paper notes, and Excel. This manual approach is the source of the pain and risk points in Section 2.4.
- The planned **Version 1 (MineFlow)** workflow replaces the manual routine with a staff-assisted, workflow-driven process. Its defining rule is that **a mine or claim is only an official order after authorized staff review and Confirm and Print**.
- The planned workflow **does not overstate automation**: it does not assume automatic Facebook comment capture, automatic messaging, or real-time synchronization, and **Pancake remains a planned, unverified integration** that no workflow currently depends on.
- The section preserves a strict separation between **confirmed current practice**, **approved planned V1 rules**, and **provisional items**, and it consolidates the **open client questions** that must be resolved before those provisional items become final.
- Exact status names and their transitions are intentionally deferred to the **Complete Order Lifecycle** and **Status Transition Rules** sections.

---

*End of Section 2 — Business Workflow. **APPROVED.** Section 3 — Current Pain Points follows.*

---

## Section 3 — Current Pain Points

### 3.1 Purpose of the Current Pain Points Section

This section documents the real operational problems A.V. Jewelry experiences today, in the client's own words, so that Version 1 (MineFlow) is built to solve problems that actually exist rather than assumed ones.

The section observes strict evidence rules:

- Only pain points **directly stated by the client** are recorded as confirmed.
- **No numbers are invented** — no frequency, percentage, financial amount, complaint volume, or staff-hours figures appear unless the client stated them. The client did not provide numeric measures, so none appear here.
- The client's **actual wording** (Filipino/Taglish) is preserved in quotation marks, with a brief English gloss for shared understanding.
- Statements that were **vague, incomplete, or unexplained** are separated into an "uncertain / requires follow-up" category and are **not** treated as confirmed facts.
- This section describes **current problems**; it does not redesign the workflow. Planned solutions are referenced only as *implications* to be developed in later sections.

### 3.2 How This Section Was Sourced

The content of this section comes from a structured client interview conducted with the Owner using the approved Current Pain Points interview guide. The interview answers are the sole evidentiary basis for the confirmed pain points below, together with the previously approved Section 1 and Section 2 content. No other source informs this section.

### 3.3 Confirmed Pain Points

The following pain points were directly stated by the client and are treated as confirmed. Client wording is quoted; English glosses are provided for clarity.

**A. During the Live**

- **Frequent buyer cancellations.** *"Mga buyer na laging nagka-cancel"* — buyers who repeatedly cancel.
- **Items reaching the wrong person.** *"Napupunta sa ibang tao ang item, hindi sa 1st miner napupunta"* — the item ends up with someone other than the first miner.
- **Simultaneous flex requests.** *"Sabay-sabay ang pagpapa-flex"* — many requests to flex (show) items arrive at the same time. *(The exact operational meaning of a "flex" request is To be confirmed with the client — see 3.11.)*
- **No immediate visibility of who mined what.** *"Hindi agad nakikita kung sino talaga ang naka-mine / anong item ang nama-mine"* — during a busy Live, staff cannot immediately see who actually mined and which item was mined.

**B. Mistaken Mines and Cancellations (current handling)**

- The current response to mistaken mines, changes of mind, or requests to switch items is **preventive advice only**: *"Pinapaalalahanan sila na mag-ingat lagi sa pag-mine at huwag basta-basta nagka-cancel"* — buyers are reminded to be careful when mining and not to cancel casually. No structured withdrawal or correction process was described in the client's answer.

**C. Invoicing**

- **Next-day invoicing.** *"Kinabukasan after Live ang invoice"* — invoices are prepared the day after the Live.
- **Stated cause.** *"Kulang ang manpower at marami ang invoice"* — not enough manpower for the volume of invoices.
- **Lost invoices.** *"Naliligaw ang invoice"* — invoices get lost, which in turn delays follow-ups. *(Where the invoice is lost — paper, chat thread, or file — is To be confirmed with the client.)*

**D. Payments (current practice)**

- A dedicated staff member checks whether payment has come in: *"May bukod na manpower ang nagche-check kung pumasok na ang payment."*
- At the same time, someone encodes to ensure a payment is not doubled and has not already been applied to another item: *"…hindi nadoble ang payment o hindi pa nagamit sa ibang item."*

**E. Unpaid Follow-ups (current practice)**

- A staff member is assigned per buyer: *"May staff na naka-toka sa bawat buyer."*
- Follow-ups are delayed because invoices get lost: *"Nade-delay dahil naliligaw ang invoice."*

**F. Layaway**

- Problems arise when the deposit is insufficient or the layaway is forfeited: *"Kapag kulang ang deposit / na-forfeit na."* *(Whether "kulang ang deposit" means deposits below the required amount are accepted, or shortfalls discovered later, is To be confirmed with the client.)*

**G. Shipping, Delivery, and Pickup**

- **Shipping.** Payment status is not immediately visible, and the amount charged to the consignee is sometimes wrong: *"Hindi agad nakikita kung may payment o nagkakamali ang amount na nasisingil sa consignee."* *(Who charges the consignee and how the error arises is To be confirmed with the client.)*
- **Delivery.** The rider sometimes misses the buyer's deadline: *"Kapag hindi umabot sa deadline ni buyer ang rider."*
- **Pickup.** Items should be collected promptly; when pickup is delayed, the item is held: *"Naho-hold ang item."*

**H. Connectivity and Live Continuity**

- Internet issues during the Live cause viewers to drop: *"Nawawala ang viewer."*
- After an interruption, the last miner is not immediately visible: *"Hindi agad nakikita kung sino ang huling miner."*
- Recovery is handled by restarting the Live: *"Nagre-relive."* *(How staff re-establish the last miner after a re-live is To be confirmed with the client.)*

### 3.4 Most Frequent Problems

Ranked by the client, not by the system:

- **Most frequent:** buyer cancellations — *"mga buyer na nagka-cancel."* The client explicitly identified this as the most frequent problem.
- Also recurring during busy Lives: the inability to immediately see who mined which item (3.3.A).

*No frequency counts or rates were provided by the client, and none are stated here.*

### 3.5 Highest-Impact Customer Problems

Ranked by the client:

- **Biggest customer impact:** the item going to someone other than the first miner — *"napupunta sa ibang tao ang item."* The client explicitly identified this as the problem with the greatest customer impact.
- Related customer-facing problems stated by the client: the rider missing the buyer's deadline, and items being held when pickup is delayed.

### 3.6 Financial Risks

The following financial risks are stated by, or directly implied by, the client's own statements. **No monetary amount was provided by the client, and none is stated here.**

- Payment mistakenly **doubled or applied to another item** — the current double-manpower check exists specifically to prevent this (3.3.D).
- **Wrong amount charged to the consignee** at shipping (3.3.G).
- **Insufficient layaway deposits and forfeited layaways** (3.3.F).
- **High cancellation volume alongside high invoice volume** — effort is spent preparing invoices for orders that do not complete (3.3.A, 3.3.C).

### 3.7 Staff Workload Issues

- **Biggest workload (client-ranked):** *"maraming invoice pero marami din ang cancel"* — many invoices to prepare while many also cancel.
- **Insufficient manpower for invoice volume**, pushing invoicing to the next day: *"kulang ang manpower at marami ang invoice"* (3.3.C).
- **Dedicated manpower consumed by payment checking** plus parallel encoding to prevent double-application (3.3.D).
- **One staff assigned per buyer** for follow-ups, delayed by lost invoices (3.3.E).

### 3.8 Owner Visibility Gaps

The client named four areas the Owner cannot easily see today:

- **Unverified payment**
- **Pending payments**
- **Layaway balance**
- **Item monitoring**

These are treated as confirmed Owner visibility needs that should inform the Owner dashboard in later sections.

### 3.9 Client's Stated Version 1 Priorities

The client's own top three priorities for the first version, in the client's words:

1. **Mapabilis ang invoice** — speed up invoicing.
2. **Mapabilis ang payment** — speed up payment.
3. **Mapabilis ang delivery / shipping** — speed up delivery / shipping.

These priorities should guide module prioritization in later sections.

### 3.10 Terminology and Workflow Distinction — "Official" Order

The client stated that a mine is considered **official** *"kapag nag-deposit na sila"* (once they have deposited) or *"kapag nag-deliver / pick up na"* (once it is delivered or picked up).

This reflects the client's business meaning of "official" and **does not replace** the approved Version 1 rule that **Confirm and Print creates the internal system order record**. To avoid confusion, three distinct layers are separated here and will be handled carefully in the **Complete Order Lifecycle** and **Status Transition Rules** sections:

| Layer | Triggering event | Meaning |
|---|---|---|
| Internal order record | **Confirm and Print** (planned V1) | The system order record exists and enters the workflow |
| Financial commitment | **Deposit / payment** | The order is financially committed — the client's sense of "official" |
| Fulfillment / completion | **Delivery or pickup** | The order is fulfilled and completed |

The planned V1 rule stands: Confirm and Print is the point at which an internal order record is created. The client's "official" corresponds to the **financial commitment** and **fulfillment** layers, not to the creation of the internal record. Reconciling the wording used with customers and staff is deferred to the later lifecycle sections.

### 3.11 Uncertain or Incomplete Answers Requiring Follow-up

The following were raised but not fully explained; they are **not** treated as confirmed facts and require follow-up:

- **Staff handoffs** — no answer was provided; the current handoff process remains fully open.
- **"Sabay-sabay ang pagpapa-flex"** — the operational meaning of a "flex" request and why simultaneous requests cause difficulty was not explained.
- **Why items reach the wrong person** — confirmed that it happens, but the cause was not stated (missed comment order, manual tracking, connectivity, or other).
- **"Naliligaw ang invoice"** — whether the invoice is lost on paper, in chat threads, or in files was not specified; the current invoice's form was not described.
- **Wrong consignee amount** — who charges the consignee and how the error arises was not specified.
- **Layaway "kulang ang deposit"** — whether below-required deposits are accepted, or shortfalls appear later, was not clarified.
- **Re-live recovery** — how the last miner is re-established after *"nagre-relive"* was not described.
- **No measurement data** — no frequency, processing time, error count, complaint volume, or staff-hours figures were provided; all remain open.

### 3.12 Workflow Implications for Version 1

*These are design directions suggested by the confirmed pain points, to be developed in later sections. They are not final rules and do not alter approved rules.*

- **Cancellations are the dominant recurring event**, supporting the need for a claim-withdrawal workflow like the one planned in Section 2; the system may also need visibility into repeat-cancelling buyers *(to be scoped, not yet a rule)*.
- **First-miner protection** — claim capture, miner-position review, and system-assisted promotion are intended to help address *"napupunta sa ibang tao ang item."*
- **Live-time visibility** — staff need to see who mined what during the Live, supporting the claim-capture screen.
- **Invoice speed and traceability** — next-day invoicing and *"naliligaw ang invoice"* validate the fast-invoice goal and the need for invoices to become traceable system records that are less likely to be misplaced.
- **Payment-to-order linkage** — the current manual guard against doubled or reused payments maps to the planned Unverified Payment workflow, with each payment tied to a specific order.
- **Shipping payment visibility and consignee-amount accuracy** — the shipping workflow should surface payment status and the exact collectible amount before dispatch.
- **Pickup hold monitoring** — held items need visibility, tied to item monitoring and inventory.
- **Live-interruption resilience** — captured claims must survive a re-live, and the last miner must be recoverable from system records rather than memory.
- **Owner dashboard direction is partially confirmed** — unverified payments, pending payments, layaway balance, and item monitoring are confirmed visibility needs that should inform dashboard design.
- **Client priorities drive sequencing** — faster invoice, faster payment, and faster delivery/shipping should guide module prioritization.

### 3.13 Open Follow-up Questions

1. What exactly is a "flex" request during a Live, and what happens when many arrive at once (*"sabay-sabay ang pagpapa-flex"*)?
2. What usually causes the item to go to someone other than the first miner?
3. When an invoice *"naliligaw,"* where is it lost (paper, chat thread, file), and what does an invoice look like today?
4. Who charges the consignee, and how does the wrong amount occur?
5. How do staff hand work to one another today? (Unanswered in the interview.)
6. For layaway, does *"kulang ang deposit"* mean below-required deposits are accepted, or shortfalls found later?
7. After a re-live, how do staff currently re-establish who the last miner was?
8. *(Optional, measurement)* Any rough sense of how many orders per Live end in cancellation — rare, occasional, or frequent? (Client ranked cancellations most frequent, but gave no scale.)

### 3.14 Section 3 Summary

- The client's most frequent problem is **buyer cancellations** (*"mga buyer na nagka-cancel"*); the highest customer impact is **items reaching the wrong person** (*"napupunta sa ibang tao ang item"*); and the heaviest workload is **many invoices alongside many cancellations**.
- Confirmed pain points span the Live (cancellations, wrong recipient, flex overload, no live visibility), invoicing (next-day, lost invoices), payments (manual double-checks), follow-ups (delayed by lost invoices), layaway (deposit shortfalls/forfeiture), shipping/delivery/pickup (payment visibility, wrong consignee amount, missed deadlines, held items), and connectivity (dropped viewers, lost last-miner, re-lives).
- The Owner's confirmed visibility gaps are **unverified payments, pending payments, layaway balance, and item monitoring**.
- The client's Version 1 priorities are **faster invoicing, faster payment, and faster delivery/shipping**.
- The client's meaning of an "official" order (deposit, or delivery/pickup) is preserved as a **terminology distinction** and does **not** override the approved rule that Confirm and Print creates the internal order record; the three layers are reconciled later.
- No frequency, financial, complaint, or workload figures were provided by the client; none are invented here, and all measurement questions remain open (3.13).

---

*End of Section 3 — Current Pain Points. **APPROVED.** Section 4 — Business Rules follows.*

---

## Section 4 — Business Rules

### 4.1 Purpose of the Business Rules Section

This section converts A.V. Jewelry's client-confirmed operating practices into **enforceable business rules** — the "must," "never," and "who may override" logic that governs every module of Version 1 (MineFlow).

Where Sections 2 and 3 described *how the business works* and *what hurts today*, this section states *what the system must enforce*. These rules are the authority that later sections (Complete Order Lifecycle, Status Transition Rules, Feature Specifications, Button Functionality Matrix, and the individual workflow sections) build upon.

This section stays business-focused and operational. It does not discuss database schema, APIs, hosting, code, or implementation details.

### 4.2 Rule Sources and Conventions

- **Source of truth.** Every rule below comes from the client-confirmed answers and follow-up answers gathered for Section 4. No rule, role, permission, deadline, fee, or exception is invented.
- **Client wording.** The client's actual wording (Filipino/Taglish) is preserved in quotation marks where useful.
- **Final vs. open.** Rules the client confirmed are stated as **final confirmed rules**. Details the client has not yet settled are marked **"To be confirmed"** and collected in 4.18.
- **Supersession.** Where a rule overrides a planned assumption from an earlier section, a **Supersession note** appears with the rule, and all such overrides are consolidated in the **Supersession Log (4.17)**. This section does not silently contradict Sections 1–3.
- **Event-based wording.** Rules are written against business events (mine, confirm claim, invoice, deposit, full payment, fulfillment) so they remain valid regardless of the final status names assigned later in the Complete Order Lifecycle and Status Transition Rules sections.

### 4.3 Reconciled Order Status Vocabulary

Section 4 uses five layers to describe an item's journey. These are **business layers**, not final system status names (those are defined later).

| Layer | Triggering event | Meaning |
|---|---|---|
| **Raw Claim** | Customer mine is recorded | The customer's mine has been captured; nothing is confirmed yet |
| **Confirmed Claim** | Staff performs **Confirm Claim & Print Label** | Staff has reviewed the claim; a **claim/reference number** is generated; the claim moves to **For Invoice** |
| **Official System Order** | **Invoice is created** | The order becomes official; an **official order number** is generated |
| **Financially Secured Order** | Deposit or payment is received | The order is financially committed |
| **Fulfilled Order** | Delivered or picked up | The order is completed |

> **Supersession note (see 4.17):** Earlier sections described "Confirm and Print" as creating the official order record. That is now superseded. **Confirm Claim & Print Label creates a Confirmed Claim and a claim/reference number — it does NOT create the official system order.** The **official system order begins only when the invoice is created**, at which point the official order number is generated.

### 4.4 Live Batch Item Entry Rules

- **R4.4.1 — Required item fields.** A Live Batch item requires: **item code, grams, quantity, item photo, and total item price.**
- **R4.4.2 — Price per gram not required.** Price per gram is **not required** for the live-selling claim workflow. It may be stored internally later if needed; Version 1 uses **total item price** as the main operational price.
- **R4.4.3 — Total item price = per individual piece.** Total item price means the price **per individual piece**, not the total for the whole quantity line.
- **R4.4.4 — Grams = per individual piece.** Grams means grams **per individual piece**; all pieces grouped under one item entry must have the **same grams**.
- **R4.4.5 — Quantity only for truly identical pieces.** Quantity is used **only when items are truly identical** — same item type, same grams, same total price, and same photo/reference.
- **R4.4.6 — Differing pieces are separate item codes.** Pieces that differ in **grams, appearance, price, or photo/reference** must be entered as **separate item codes**.
- **R4.4.7 — Item photo required.** An **item photo is required**; **one photo per item entry** is enough. For quantity greater than 1, the photo **represents the item group**. **Visually different pieces must not be grouped.**

> **Supersession note (see 4.17):** Price per gram is no longer a required live-selling field for Version 1; the required operational item price is **total item price per piece**, and an **item photo is now required** for Live Batch item entry. Grams remains required, so the layaway fee (₱150 × grams × months) is unaffected.

### 4.5 Claim / Buyer Field Rules

- **R4.5.1 — Required claim fields.** A claim requires: **complete buyer name, mine date and time, mine comment or reference, claim position / allocation status, claim/reference number, assigned item, and total item price.** For **unique items**, claim position means **1st miner or 2nd miner**. For **multi-stock items**, claim position means **allocated unit number, waitlist position, or excess claim status** (consistent with 4.9).
- **R4.5.2 — Claim inherits item price.** The claim **inherits the assigned item's total item price.**
- **R4.5.3 — Multi-unit claim price.** For a multi-unit claim, **claim price = total item price per piece × quantity claimed.**
- **R4.5.4 — No casual price edits.** Staff **must not casually edit the claim price.** A **price override is a high-risk action** requiring **selected admin action plus Owner approval** (see 4.16).
- **R4.5.5 — Item photo on Claim Review.** The **item photo must appear on the Claim Review screen** so staff can visually verify the correct item before Confirm Claim & Print Label.
- **R4.5.6 — Editable pre-print details.** Staff may **edit or confirm other extracted or suggested claim details before printing** (the claim price excepted, per R4.5.4).

### 4.6 Label / Sticker Field Priority Rules

- **R4.6.1 — Label field priority.** The label/sticker prioritizes: **claim/reference number, complete buyer name, mine date and time, item code, grams, total item price, and claim position / allocation status.**

### 4.7 Claim and Mine Rules

- **R4.7.1 — No cancellation limit or penalty during Live.** A buyer who mines and then cancels during the Live faces no limit and no penalty — *"Walang limit."*
- **R4.7.2 — Buyers may mine again after cancelling.** A buyer who cancelled may mine again — *"Okay lang mag-mine ulit."*
- **R4.7.3 — Switching item before invoice/payment.** When a buyer switches to another item before invoice/payment, the **original claim/item is cancelled or withdrawn** and the buyer **proceeds with the new item** — *"Palit item na agad, then cancel na yung item niya."* (Pre-invoice, the original is handled as a withdrawn claim; see 4.13.)

### 4.8 Claim Confirmation Rules

- **R4.8.1 — Confirm Claim & Print Label.** Authorized staff confirm a reviewed claim through the **Confirm Claim & Print Label** action.
- **R4.8.2 — Claim/reference number.** At claim confirmation, the system generates a **claim/reference number** — *"claim/reference number is gusto namin."*
- **R4.8.3 — Move to For Invoice.** A confirmed claim moves to the **For Invoice** stage.
- **R4.8.4 — Not yet an official order.** A Confirmed Claim is **not** an official system order. The official system order is created only at invoice creation (see 4.10).
- **R4.8.5 — Label prints only on staff action.** Label printing happens **only after authorized staff clicks Confirm Claim & Print Label.**
- **R4.8.6 — No automatic printing.** A screenshot upload, mine detection, Pancake event, OCR extraction, or system suggestion **must not automatically trigger printing.**

> **Supersession note (see 4.17):** This repositions the former "Confirm and Print." The action is retained and renamed **Confirm Claim & Print Label**; its output is a Confirmed Claim with a claim/reference number, not the official order.

### 4.9 Miner and Allocation Rules

Two separate models apply, depending on whether the item entry is unique or multi-stock. **The two models never mix:** an item entry is either unique (quantity 1) or multi-stock (quantity greater than 1).

**A. Unique item (quantity = 1)**

- **R4.9.1 — Only 1st and 2nd miner are recorded** — *"Hanggang 2nd miner."*
- **R4.9.2 — No 3rd miner.** The system does not record a third miner.
- **R4.9.3 — No automatic transfer to the 2nd miner.** If the 1st miner does not continue, the item is **not** automatically transferred to the 2nd miner.
- **R4.9.4 — Staff must check the 2nd miner is a sure buyer** before proceeding — *"Kailangan munang i-check kung sure miner si buyer."*
- **R4.9.5 — 2nd-miner priority.** If a 2nd miner was recorded, that miner has **priority** before the item becomes generally available — *"Kung may naisulat na 2nd miner, siya ang priority."*
- **R4.9.6 — Return to available stock.** If no valid 2nd miner proceeds, the item **returns to available stock** — *"Available stock."*

**B. Multi-stock item (quantity > 1)**

- **R4.9.7 — Allocation up to available quantity.** The system allocates valid claims **up to the available quantity**, in **verified claim order**.
- **R4.9.8 — Excess becomes Waitlist / Excess Claim.** Claims beyond available quantity become **Waitlist / Excess Claim for staff review.**
- **R4.9.9 — No fixed maximum waitlist count** in Version 1 unless later approved.
- **R4.9.10 — Multi-unit claims.** One buyer may claim more than one unit **only if sufficient stock is available and staff confirms the quantity.**
- **R4.9.11 — Requested quantity exceeds stock.** Allocate only the **confirmed available quantity** and mark the **excess as Needs Review or Waitlist**, depending on the final staff decision.
- **R4.9.12 — No automatic re-allocation.** If an allocated unit becomes available through cancellation, expiry, or withdrawal, the system **must not automatically transfer** it to the next waitlist buyer.
- **R4.9.13 — Needs Staff Review on re-allocation.** The system **identifies the next eligible waitlist buyer** and marks it **Needs Staff Review**; authorized staff must **check whether the waitlist buyer is still a sure buyer** before confirming the allocation.
- **R4.9.14 — Hold applies per claim.** Each allocated multi-stock claim follows the **same 3-day hold after the invoice is sent**, applied **per confirmed claim/order**, not only per item code (see 4.11).

> **Supersession note (see 4.17):** The unique-item model (Part A) replaces the earlier planned up-to-three-miners and system-assisted promotion (propose 2nd→1st, 3rd→2nd). There is no 3rd miner and no automatic promotion. The **unique-item miner model and the multi-stock allocation model must remain separate.**

### 4.10 Invoicing and Official Order Rules

- **R4.10.1 — Invoice creation creates the official system order.** The order becomes official when the invoice is created — *"Kapag na-invoice na."*
- **R4.10.2 — Official order number at invoice.** The **official order number** is generated at invoice creation.
- **R4.10.3 — Next-day sending schedule.** Invoices are **normally sent the day after the Live** — *"Kinabukasan after Live."*
- **R4.10.4 — Faster preparation allowed.** The system may prepare invoices faster, but **next-day sending remains the confirmed business schedule unless same-day is later approved.**

> **Supersession note (see 4.17):** Section 1's success outcome and Section 2's "within-minutes" invoice target are reframed here: faster *preparation* is allowed, while the confirmed *sending schedule* is next-day. This is a schedule rule, not a system-speed limit.

### 4.11 Hold Period and Deadline Rules

- **R4.11.1 — Hold period is 3 days total** — *"3 days."*
- **R4.11.2 — Count starts after invoice is sent** — *"After invoice is sent."*
- **R4.11.3 — No extension beyond 3 days** unless later explicitly approved — *"Maximum of 3 days lang."*
- **R4.11.4 — Single 3-day deadline for both payment and fulfillment.** The 3-day deadline applies to **deposit/payment and delivery/pickup**, depending on transaction type — *"Pareho."*
- **R4.11.5 — Straight-order full-payment deadline: To be confirmed.** For straight orders that are **not** layaway and have **no shipping deposit**, whether the 3-day deadline requires **full payment** or a partial payment is **To be confirmed** (see 4.18).

> **Supersession note (see 4.17):** This replaces the earlier planned 24-hour hold with a one-day authorized extension. The hold is now 3 days total with no extension, counted from after the invoice is sent.

### 4.12 Deposit and Payment Rules

- **R4.12.1 — Layaway minimum deposit is 20%** of total item value.
- **R4.12.2 — Shipping deposit is at least ₱1,000**, with the **remaining balance payable as COD** — *"at least ₱1,000 then COD balance."*
- **R4.12.3 — Shipping orders remain cancellable after the ₱1,000 deposit** — *"Pwede pa."* (Contrast with layaway; see 4.13 and 4.14.)
- **R4.12.4 — Payment verification authority.** Payment may be verified by the **Owner and selected/assigned payment staff** — *"Both."*
- **R4.12.5 — Verified before release.** Payment **must be verified before an item is shipped or released for pickup** — *"Yes, dapat verified."*

### 4.13 Cancellation Rules

- **R4.13.1 — During Live: no cancellation limit or penalty** (see 4.7).
- **R4.13.2 — Before invoice/payment: switching cancels/withdraws the original.** Switching item before invoice/payment cancels or withdraws the original item/claim (see 4.7.3).
- **R4.13.3 — Layaway: non-cancellable after deposit** — *"bawal nang ma-cancel kapag naka-deposit na."*
- **R4.13.4 — Shipping: cancellable after ₱1,000 deposit** — *"Pwede pa."*
- **R4.13.5 — Destination on cancel/expire/withdraw.** Cancelled, expired, or withdrawn claims/orders **return to available stock**, subject to **2nd-miner priority (unique items) or waitlist review (multi-stock items)** when applicable (see 4.9).

### 4.14 Layaway Rules

- **R4.14.1 — Minimum down payment: 20%.**
- **R4.14.2 — Maximum term: 3 months.**
- **R4.14.3 — Layaway fee: ₱150 × item grams × number of months.**
- **R4.14.4 — Grace period: maximum 10 days** before forfeiture eligibility — *"maximum of 10 days."*
- **R4.14.5 — Non-cancellable after deposit**, because the item goes to the financer — *"napupunta sa financer."*
- **R4.14.6 — Financer must be recorded.** The financer assigned to a layaway item **must be recorded and traceable** — *"Yes."*
- **R4.14.7 — Financer fields/workflow: To be confirmed.** The exact financer fields and workflow are **To be confirmed** (see 4.18).

### 4.15 Reminder Rules

- **R4.15.1 — Day 1 reminder.**
- **R4.15.2 — Day 2 reminder.**
- **R4.15.3 — Day 3 final reminder.**
- **R4.15.4 — Anchored to the 3-day hold.** The reminder cadence is anchored to the **3-day hold period, counted after the invoice is sent** (see 4.11).

> **Supersession note (see 4.17):** This re-anchors the earlier planned Day 1 / Day 2 / Day 3 reminders from a 24-hour hold to the confirmed 3-day hold that starts after the invoice is sent.

### 4.16 High-Risk Action and Authority Rules

- **R4.16.1 — Selected admins may initiate or process high-risk actions** — *"Selected admins."*
- **R4.16.2 — Owner approval is still required** for high-risk actions — *"Yes, Owner approval is still needed."*
- **R4.16.3 — High-risk actions are:**
  - cancelling official orders
  - approving forfeiture
  - overriding price
  - releasing items
- **R4.16.4 — Roles and approval flow: To be confirmed.** The exact selected-admin roles, the approval flow, and permission tiers are **To be confirmed** (see 4.18).

> **Supersession note (see 4.17):** Earlier sections referred to "Owner-authorized cancellation" and to forfeiture requiring "authorized staff or Owner." This is tightened: high-risk actions may be initiated by selected admins but **require Owner approval**.

### 4.17 Supersession Log

The following planned assumptions from earlier sections are overridden by Section 4. The affected earlier sections will be reconciled through their own section-level updates; this log keeps the Bible internally consistent in the meantime.

| # | Earlier planned assumption | Superseded by (Section 4) |
|---|---|---|
| 1 | Confirm and Print creates the official order record | Confirm Claim & Print Label creates a Confirmed Claim + claim/reference number; not the official order (4.3, 4.8) |
| 2 | Official order exists at Confirm and Print | Official system order begins at **invoice creation**, with official order number (4.3, 4.10) |
| 3 | "Confirm and Print" as the action name | Described as **Confirm Claim & Print Label** (4.3, 4.8) |
| 4 | Up to three miners (1st, 2nd, 3rd) | **Only 1st and 2nd miner**; no 3rd miner (4.9 A) |
| 5 | 24-hour hold period | **3-day hold**, counted after invoice is sent (4.11) |
| 6 | One-day authorized extension | **Maximum 3 days total**, no extension unless later approved (4.11) |
| 7 | Automatic / system-assisted miner promotion (2nd→1st, 3rd→2nd) | **2nd-miner priority with staff sure-buyer check**; then return to available stock (4.9 A) |
| 8 | Invoice within-minutes target | Faster **preparation** allowed; **next-day sending** is the confirmed schedule (4.10) |
| 9 | Reminders anchored to 24-hour hold | Reminders **re-anchored to the 3-day hold** after invoice sent (4.15) |
| 10 | Financer not modeled | **Financer added** as a required, traceable layaway record (4.14) |
| 11 | Price per gram as a required live-selling field | **Price per gram no longer required** for Version 1 (4.4) |
| 12 | "grams × price per gram" as the required operational price | **Total item price per piece** is the required operational item price (4.4, 4.5) |
| 13 | Item photo not specified as required | **Item photo now required** for Live Batch item entry (4.4) |
| 14 | Single/blended miner-and-stock handling | **Unique-item miner model and multi-stock allocation model must remain separate** (4.9) |

### 4.18 Open / To-Be-Confirmed Rules

These details remain unresolved and are **not** invented here. They are recorded as open items to be settled before the affected rules become final.

1. **Full-payment deadline for straight orders** — for non-layaway, non-shipping-deposit orders, whether the 3-day deadline requires full payment or a partial payment.
2. **Price-override allowed stage** — at which stage(s) a price override is permitted (e.g., before invoice only, or also after the official order).
3. **Same-day invoicing conditions** — the conditions, if ever approved, under which same-day invoice sending would replace the next-day schedule.
4. **Exact selected-admin roles and Owner approval flow** — which roles qualify as "selected admins" and how Owner approval is requested and granted for high-risk actions.
5. **Exact financer fields and workflow** — the specific data captured and the process for financer assignment in layaway.

### 4.19 Section 4 Summary

- Section 4 converts A.V. Jewelry's client-confirmed practices into **enforceable business rules** covering Live Batch item entry, claim and buyer fields, labels, claims, claim confirmation, miners and multi-stock allocation, invoicing, hold periods, deposits and payments, cancellations, layaway, reminders, and high-risk authority.
- It **resolves the central terminology conflict**: **Confirm Claim & Print Label** creates a Confirmed Claim and claim/reference number, while the **official system order begins at invoice creation**.
- It **simplifies item entry**: total item price per piece is the required operational price, price per gram is no longer required, and an item photo is required and shown on the Claim Review screen.
- It **keeps the two allocation models separate**: unique items follow the 1st/2nd-miner rule; multi-stock items follow allocation-up-to-quantity with waitlist and staff-reviewed re-allocation.
- It **records every override** of earlier planned assumptions in the **Supersession Log (4.17)** so the Bible remains internally consistent, and **preserves the client's confirmed figures exactly** (3-day hold; layaway 20% down, ≤ 3 months, ₱150 × grams × months fee, 10-day grace; shipping ≥ ₱1,000 + COD), inventing none.
- It keeps genuinely unsettled details in **4.18 (Open / To-Be-Confirmed)** rather than guessing at them.

---

*End of Section 4 — Business Rules. **APPROVED.** Section 5 — User Roles & Permissions follows.*

---

## Section 5 — User Roles & Permissions

### 5.1 Purpose of the User Roles & Permissions Section

This section defines **who can access the system and who can perform which actions** in Version 1 (MineFlow). It translates the authority rules from Section 4 — especially the high-risk action rules (R4.16) and payment-verification authority (R4.12.4) — into a simple, practical role and permission model.

The goal is to keep Version 1 **simple and controllable**: a small number of roles, clear permission toggles per duty, and the Owner retaining control over high-risk actions. This section stays business-focused and operational. It does not discuss database schema, APIs, hosting, code, or implementation details.

### 5.2 Role Model Overview

- **Version 1 uses three main roles only:** Owner, Selected Admin, and Staff.
- **Owner is the highest authority** — the full administrator and the sole approver of high-risk actions.
- **Selected Admin is trusted staff** with limited elevated capability (may initiate/process high-risk actions if granted the permission — Owner approval still required).
- **Staff is a normal operational user** who performs only the duties enabled by their permission toggles.
- **Payment Verification is a permission toggle, not a standalone role.** It can be assigned to a Staff or Selected Admin account; the Owner always has it.
- **Customers do not have system accounts in Version 1** — customers do not log in.

### 5.3 Owner Role

The Owner is the highest authority in the system.

- **Full administrator** with the highest authority.
- Can **create, edit, and disable** staff and admin accounts.
- Can **assign permission toggles** to any account.
- Can **approve high-risk actions** (the required approval step).
- **Always has payment-verification authority**, regardless of toggles.
- Can **view all dashboards, reports, and audit trails**.
- Can **perform all operational actions** if needed.

### 5.4 Selected Admin Role

The Selected Admin is a trusted staff role with limited elevated capability.

- Can **perform assigned operational duties** (based on their permission toggles).
- **May initiate/process high-risk actions only if granted the "Initiate High-Risk Action" permission.**
- **Still needs Owner approval** for high-risk actions.
- **Cannot approve their own high-risk action.**
- **Cannot exceed Owner authority.**
- **Cannot perform duties not assigned to their account.**

### 5.5 Staff Role

Staff are normal operational users.

- Can **only perform assigned duties** based on their permission toggles.
- **Cannot initiate or approve high-risk actions.**
- **Cannot override prices.**
- **Cannot release items** unless later approved through the high-risk authority rules.
- **Cannot verify payments** unless the Payment Verification permission is enabled on their account.
- **Cannot perform duties outside their assigned permissions.**

### 5.6 Permission Toggle Model

Version 1 uses a simple **role + permission-toggle** model. Each account has:

- **one main role** (Owner / Selected Admin / Staff), and
- **assigned permission toggles** based on that person's actual duty.

**Version 1 permission toggles:**

- Live Batch Item Entry
- Claim Capture
- Claim Review
- Item Correction
- Miner / Allocation Review
- Confirm Claim & Print Label
- Invoice Preparation
- Payment Verification
- Layaway Monitoring
- Shipping / Pickup Preparation
- Reminder Handling
- Inventory Monitoring
- Customer Support
- View Reports
- Initiate High-Risk Action

The **Owner implicitly has all permissions**; toggles are used to configure Staff and Selected Admin accounts.

### 5.7 Payment Verification Permission

- **Payment Verification is a capability (permission toggle), not a standalone role.**
- The **Owner always has payment-verification authority.**
- A **Staff or Selected Admin may verify payments only if the Payment Verification permission is enabled** on their account.
- **Payment verification does not automatically grant release-item authority.**
- **Release item remains a high-risk action** and requires Owner approval, based on Section 4 (R4.16).

### 5.8 High-Risk Action Authority

**High-risk actions are:**

- cancelling official orders
- approving forfeiture
- overriding price
- releasing items

**Rules:**

- **Only the Owner can approve** high-risk actions.
- A **Selected Admin may initiate/process** high-risk actions **only if granted the "Initiate High-Risk Action" permission** — Owner approval is still required.
- **Staff cannot initiate or approve** high-risk actions unless later approved.
- The flow is: **initiate → Owner approval → execute.**
- **If the Owner is unavailable, the action waits.**
- **There is no Owner-delegation rule in Version 1.**

### 5.9 Normal Claim Workflow Permissions

- A **staff member may capture and confirm a claim** if their account holds the needed permissions (e.g., Claim Capture and Confirm Claim & Print Label).
- **Two separate staff members are not required** for normal claim capture and confirmation.
- **Claim capture and confirmation are not high-risk** unless a price override, cancellation of an official order, forfeiture, or item release is involved.
- **High-risk actions still require Owner approval** (see 5.8).

### 5.10 Customer Account Rule

- **Version 1 has no public customer accounts.**
- **Customers do not log in to the system.**
- **Customer activity is recorded by staff** through claims, invoices, payments, layaway, shipping, pickup, and customer-support records.

### 5.11 Permission Boundaries

- **No shared logins.**
- **Every staff account must be individual.**
- Users **cannot perform actions outside their role/permission.**
- **Permission changes are controlled by the Owner.**
- **Staff actions are attributable to their account.**
- **Detailed audit log rules will be defined later** in the Audit Log Requirements section.

### 5.12 Open / To-Be-Confirmed Permission Items

1. **Exact selected-admin roster** — which real staff members are designated as Selected Admins.
2. **Exact Owner approval mechanism** — how Owner approval for high-risk actions is requested and recorded (in-system approval vs. verbal-plus-logged).
3. **Actual permission toggles assigned to each named staff member** — the per-account configuration.
4. **Initiate High-Risk Action granularity** — whether it remains a single toggle or later splits into separate toggles per high-risk action.

### 5.13 Section 5 Summary

- Section 5 keeps Version 1 **simple**: **three roles** (Owner, Selected Admin, Staff) plus a set of **permission toggles** assigned per duty.
- **Owner is the highest authority** and the **sole approver of high-risk actions**; there is **no delegation** in Version 1.
- **Payment Verification is a permission toggle**, not a separate role; the Owner always holds it.
- **Normal claim capture and confirmation need only one authorized staff member**, while **high-risk actions always require Owner approval**.
- **No public customer accounts** exist in Version 1; customer activity is recorded by staff.
- Individual, attributable logins are required; detailed audit behavior is deferred to the Audit Log Requirements section.

---

*End of Section 5 — User Roles & Permissions. **APPROVED.** Section 6 — Complete Order Lifecycle follows.*

---

## Section 6 — Complete Order Lifecycle

### 6.1 Purpose of the Complete Order Lifecycle Section

This section defines the **complete operational journey** of a claim/order in Version 1 (MineFlow) — from a captured mine through confirmation, invoice, payment/deposit, fulfillment, cancellation, expiry, layaway, forfeiture, and stock return.

- **Section 6 defines the operational lifecycle stages** — the named states an item, claim, or order moves through in day-to-day operation.
- **Section 22 (Status Transition Rules) will later define the strict allowed status transitions** — which stage may move to which, and under what conditions.

This section stays business-focused and operational. It does not discuss database schema, APIs, hosting, code, or technical implementation details. It introduces no new business rules; every rule here traces to approved Sections 1–5 and the approved Section 6 pre-draft clarifications. Unresolved details are marked **To be confirmed** and are never silently resolved.

### 6.2 Lifecycle Layers and Operational Stages

The operational stages map to the five business layers established in Section 4.3.

**Raw Claim layer**
- Pending Claim (Needs Review)
- Claim Review

**Confirmed Claim layer**
- Confirmed Claim / For Invoice

**Official System Order layer**
- Official System Order / Invoiced
- Awaiting Required Payment or Deposit
- Payment Submitted / Unverified

**Financially Secured layer**
- Required Payment / Deposit Verified
- For Preparation
- For Shipping / For Pickup
- Approved for Release

**Fulfilled Order layer**
- Shipped / Picked Up
- Completed

**Off-path / return / exception stages**
- Withdrawn
- Cancelled
- Expired / Overdue
- Waitlist / Excess Claim
- Needs Staff Review
- Needs Owner Approval
- Layaway Active
- Layaway Overdue
- Layaway Grace Period
- Forfeiture-Eligible
- Forfeited / Needs Owner Decision
- Returned to Available Stock

**Clarifications:**
- **Pending Claim** is the operational name under the **Raw Claim** layer.
- **Needs Review** is for **initial captured-claim review**.
- **Needs Staff Review** is for **2nd-miner or waitlist re-allocation review**.
- **Required Payment / Deposit Verified does not always mean Paid in Full** — it means the amount required at the current lifecycle stage has been verified.
- A separate **Paid in Full** state **may be defined later in Section 22**.

### 6.3 Claim Capture Entry Path

```
Pinned mine / screenshot capture
   → Pending Claim (Needs Review)
   → Claim Review
   → Confirm Claim & Print Label
```

**Rules:**
- **Capture never confirms a claim.**
- **Capture never prints automatically.**
- **Capture never sends an invoice automatically.**
- The screenshot/frame provides the **buyer name, mine comment, and visible reference**.
- **Item details come from the Current Flex Item record** (not guessed from the screenshot).
- The **Android floating Capture Claim companion is planned, subject to technical validation.**
- **iOS Version 1 uses screenshot → Share to MineFlow.**
- Full platform behavior is deferred to **Sections 12, 13, 20, and 24**.

### 6.4 Claim Review and Confirmation Path

At Claim Review, authorized staff perform:
- buyer review
- item match
- item photo verification
- item correction
- miner position or allocation review
- duplicate / repeated claim review
- **Confirm Claim & Print Label**
- claim/reference number generation
- move to **Confirmed Claim / For Invoice**

**Confirm Claim & Print Label does NOT create or send the invoice, and does NOT create the Official System Order.**

### 6.5 Unique-Item Lifecycle

For **quantity = 1**:
- record **only 1st and 2nd miner**
- **no 3rd miner**
- **no automatic transfer**
- if the 1st miner does not proceed, the item **requires staff review**
- a recorded **2nd miner has priority**
- staff **checks whether the 2nd miner is still a sure buyer**
- the **exact 2nd-miner priority time window remains To be confirmed**
- if no valid 2nd miner proceeds, the item **may return to Available Stock**

### 6.6 Multi-Stock Lifecycle

For **quantity greater than 1**:
- allocate valid claims **up to available quantity in verified claim order**
- excess claims become **Waitlist / Excess Claim**
- one buyer may claim multiple units **only if stock is available and staff confirms the quantity**
- a freed unit **does not automatically transfer**
- the next eligible waitlist buyer moves to **Needs Staff Review**
- staff **confirms whether that buyer is still a sure buyer**
- confirmed allocated claims proceed **independently or through an approved grouped invoice**

### 6.7 For-Invoice Review and Grouping

- Confirmed Claims **remain For Invoice** until authorized staff reviews them.
- Staff may review the **buyer's complete confirmed claims**.
- Claims may be **grouped only if they have the same approved payment and fulfillment arrangement**.
- **Different arrangements require separate invoices/orders.**
- **Complete claims may be invoiced while incomplete claims remain For Invoice.**
- Claims **must not be silently added after an invoice has been sent.**
- Additional claims require a **new invoice/order or a later approved invoice-revision workflow**.

**Identity vocabulary:**
- **claim/reference number** = item-level claim identity
- **invoice number** = billing-document identity
- **official order number** = grouped transaction/order identity

**For Version 1:**
- one grouped invoice = **one Official System Order**
- one grouped invoice = **one invoice number**
- one grouped invoice = **one official order number**
- included claims **retain their own claim/reference numbers**

> Example — Official Order: **ORD-000125**, Invoice: **INV-000125**, included claims: **CLM-001, CLM-002, CLM-003**.

### 6.8 Approve & Send Invoice Path

```
Confirmed Claim / For Invoice
   → authorized staff reviews the buyer's complete claims
   → Approve & Send Invoice
   → invoice successfully created and sent
   → Official System Order created
   → official order number generated
   → invoice number generated
   → 3-day hold starts
```

**Rules:**
- Invoice sending is **separate from Confirm Claim & Print Label**.
- The invoice is sent **only after authorized staff clicks Approve & Send Invoice**.
- **Nothing automatically sends an invoice.**
- Invoices **may be sent immediately** after approved review.
- The earlier **next-day invoice default is superseded** (see 6.21).
- Claims not yet complete **remain For Invoice**.

### 6.9 Grouped-Order Hold Period

- The **3-day hold starts after the invoice is successfully sent.**
- A grouped invoice/order has **one shared hold-start date and deadline**.
- **All claims included in that invoice share that deadline.**
- Claims in **separate invoices have separate hold periods**.
- **Day 1, Day 2, and Day 3 reminders** are anchored to that hold.

### 6.10 Payment and Deposit Lifecycle

```
Official System Order
   → Awaiting Required Payment / Deposit
   → Payment Submitted / Unverified
   → Required Payment / Deposit Verified
```

**Clarification:** **Required Payment / Deposit Verified** means the amount **required at the current lifecycle stage** has been verified. It **does not always mean the full item price is paid.**

**Approved arrangements:**

- **Layaway:** minimum DP = **20% of total item price**.
- **Shipping:** minimum deposit = **at least ₱1,000**; the **remaining balance may be COD** under the approved arrangement.
- **Eligible non-brand-new / subasta / factory-item arrangement:** usual minimum DP = **₱1,000**; **exact category wording and eligibility remain To be confirmed**.
- **Straight payment / pickup:** the **exact full-payment requirement within the 3-day period remains To be confirmed**.

**System calculations:**
- minimum layaway DP = **total item price × 20%**
- remaining balance = **total item price − actual DP received**
- layaway fee = **₱150 × grams × number of months**

**How the layaway fee is applied to the financed balance or installments remains To be confirmed** (not invented here).

### 6.11 Layaway Lifecycle

```
Invoice sent
   → 20% minimum DP verified
   → Layaway Active
   → installment monitoring
   → completed payment
        or
   → Layaway Overdue
   → maximum 10-day grace
   → Forfeiture-Eligible
   → Owner approval
   → Forfeited / Needs Owner Decision
```

**Rules:**
- maximum term is **3 months**
- layaway fee formula remains **₱150 × grams × months**
- **layaway cannot be cancelled after deposit**
- **financer must be recorded and traceable**
- **forfeiture is never automatic**
- a **forfeited item does not automatically return to Available Stock**
- the **exact forfeited-item disposition involving the financer remains To be confirmed**

### 6.12 Shipping Lifecycle

```
Required shipping deposit/payment verified
   → For Preparation
   → For Shipping
   → Approved for Release
   → Dispatched
   → Delivered
   → Completed
```

**Rules:**
- **normal shipping** after the verified required deposit/payment and proper preparation is an **operational action**
- an **authorized Selected Admin or assigned fulfillment staff may approve normal shipping**
- **Owner approval is not required for every normal shipping dispatch**
- the **approved COD balance may remain unpaid until delivery**
- a shipping order **may still be cancelled after the ₱1,000 deposit**, subject to the official-order cancellation rule (see 6.15)

### 6.13 Pickup Lifecycle

```
Required payment under the approved arrangement verified
   → For Preparation
   → For Pickup
   → Approved for Release
   → Picked Up
   → Completed
```

**Rules:**
- an **authorized Selected Admin or assigned fulfillment staff may approve normal pickup release**
- **do not assume all pickup orders always require full payment**
- the **exact straight-pickup full-payment requirement remains To be confirmed**

### 6.14 Normal Versus Exceptional Release

**Normal release:**
- verified required payment/deposit
- complete preparation
- no mismatch, dispute, or exception
- approved by authorized admin/fulfillment staff

**Exceptional release:**
- release without verified required payment
- unpaid balance outside the approved arrangement
- mismatch or dispute
- incomplete requirements
- manual release override
- release outside the normal approved flow
- action beyond assigned staff authority

```
Exceptional release
   → Needs Owner Approval
   → Owner approves or rejects
   → release or hold
```

**Only exceptional release is high-risk and requires Owner approval.**

> **Reconciliation note (see 6.21):** Sections 4 and 5 currently use the broader phrase "releasing items" as a high-risk action. That wording must later be refined to distinguish **normal release (operational, permission-based)** from **exceptional release (high-risk, Owner approval)**.

### 6.15 Withdrawal and Cancellation Lifecycle

**Pre-invoice:**
- the buyer switches item or withdraws
- the original claim becomes **Withdrawn**
- the item **may return to available stock**, subject to miner/waitlist priority

**Post-invoice:**
- cancellation of an **Official System Order is high-risk**
- a **Selected Admin may initiate if permitted**
- **Owner approval required**
- after approval, the order becomes **Cancelled**
- the item **may return to available stock**, subject to miner/waitlist priority

**Layaway after deposit cannot be cancelled.**

### 6.16 Expiry and Overdue Lifecycle

```
Invoice sent
   → 3-day hold
   → Day 1 reminder
   → Day 2 reminder
   → Day 3 final reminder
   → deadline lapses without required payment/deposit
   → Expired / Overdue
   → item may return to available stock
```

**Apply:**
- **unique item:** 2nd-miner priority and **Needs Staff Review**
- **multi-stock:** next waitlist buyer and **Needs Staff Review**
- **no automatic transfer or re-allocation**

### 6.17 Returned-to-Stock Lifecycle

Items may return to available stock after:
- a **withdrawn pre-invoice claim**
- an **approved cancellation**
- an **expired unpaid order**

**Before general availability:**
- a **unique item checks the recorded 2nd miner**
- a **multi-stock item checks the next eligible waitlist buyer**
- **staff review is required**
- **no automatic transfer**

**Forfeited layaway items are excluded from automatic stock return.**

### 6.18 Owner Approval Points

Owner approval is required for:
- **cancellation of an Official System Order**
- **approval of forfeiture**
- **price override**
- **exceptional / high-risk release**

**Flow:**
```
initiate
   → Needs Owner Approval
   → Owner approval or rejection
   → execute or hold
```

- **No Owner delegation in Version 1.**
- **If the Owner is unavailable, the high-risk action waits.**

### 6.19 Admin and Staff Review Points

- Claim Capture
- Claim Review
- Item Correction
- Miner / Allocation Review
- Confirm Claim & Print Label
- Invoice review
- Approve & Send Invoice
- Payment Verification
- Layaway Monitoring
- Shipping / Pickup Preparation
- normal fulfillment approval
- reminder handling
- inventory / returned-stock review

**All actions require the corresponding permission from Section 5.**

### 6.20 Existing and Migrated Record Lifecycle

A.V. Jewelry already has existing customer and layaway records stored in Excel. Version 1 must allow authorized staff to enter these records manually **without** forcing them through the normal Live Claim → Confirm Claim → Invoice flow.

**Entry path:**
```
Existing Excel / historical record
   → Add Existing Layaway or Migrate Existing Record
   → authorized staff reviews and enters the historical details
   → record is marked Existing Record / Migrated Record / Imported from Excel
   → record enters its verified historical state:
        - Active Layaway
        - Layaway Overdue
        - Layaway Grace Period
        - Completed
        - Cancelled
        - Forfeited / Needs Owner Decision
        - Other verified historical status
```

**Rules:**
- Migrated records **bypass** Pending Claim, Claim Review, Confirm Claim & Print Label, For Invoice, and Approve & Send Invoice.
- Migrated records **remain visibly marked** as historical/migrated.
- **Actual historical amounts and dates are preserved.**
- **New deposit rules are not applied retroactively.**
- **Item photo is optional** for migrated records if unavailable.
- **Possible duplicate customers require staff review.**
- **Do not auto-merge customer profiles.**
- **Version 1 begins with manual entry.**
- **CSV/Excel bulk import is deferred** to a later feature.
- Detailed customer profiles, migration fields, search, reporting, and data design are **deferred to Sections 10, 17, 20, 23, 25, and 28**.

**Migrated-record counting:**
- A migrated layaway or historical transaction that represents a real completed or ongoing sale counts as **one historical Official Order**.
- If it is currently active as layaway, it **also appears in the Active Layaways metric**.
- **These metrics are not additive** — active layaways are already included within official orders where applicable.
  > Example — Total Official Orders: **12**; Active Layaways: **2**. The 2 active layaways are already included within the 12 official orders where applicable.
- Migrated records that **never had a MineFlow claim stage do not count under Total Claims**.
- **Claims, official orders, active layaways, completed orders, cancelled orders, and expired orders remain separate metrics.**

**Existing Record Entry / Migration permission (Version 1 capability):**
- The **Owner always has** this capability.
- A **Selected Admin may use it if the permission is enabled**.
- **Staff may use it only if specifically enabled by the Owner**; it is **not enabled for all Staff by default**.
- **Customers have no system access.**
- Manual migration **does not require separate Owner approval for every record**, but **all entries and edits must remain attributable to the individual staff account**.
- Detailed audit requirements for historical financial edits are **deferred to Section 31**.

**Historical financial preservation:**
Migrated records preserve the **actual historical values** entered by authorized staff, including: original item price, original down payment, total payments received, remaining balance, start date, due date, financer, and historical status. These records are **not retroactively recalculated using current deposit rules**.

**Customer history:**
Customer history combines: migrated historical orders, manually entered existing layaways, new MineFlow claims, new Official System Orders, payments, layaway records, and shipping and pickup records. **Claims are clearly distinguished from orders.**

### 6.21 Reconciliation With Earlier Sections

**Invoice rules:**
- the next-day invoice default is **superseded**
- **immediate sending after approval is now allowed**
- **Approve & Send Invoice is the invoice trigger**
- the **Official System Order begins after successful invoice send**
- the **official order number is generated after successful send**
- a **grouped invoice = one official order**
- grouped claims **retain their own claim/reference numbers**
- a **shared hold applies per grouped invoice**
- **same-arrangement-only grouping**
- **no silent claim addition after invoice send**

**Release rules:**
- **normal verified fulfillment is operational and permission-based**
- **exceptional release is high-risk and requires Owner approval**

**Deposit rules:**
- layaway **20%**
- shipping **≥ ₱1,000 + approved COD**
- the eligible **non-brand-new / subasta / factory-item ₱1,000 rule is added**, exact terminology **To be confirmed**

**Migrated / existing records:**
- current **Section 4 deposit rules apply to new transactions**, while **migrated records preserve actual historical values**
- the normal **Official System Order trigger through Approve & Send Invoice applies to new MineFlow orders**, while **migrated historical orders enter through the approved migration path**
- **item photo is required for new Live Batch items but optional for migrated records** when unavailable
- **Section 5 later needs the Existing Record Entry / Migration permission added**

**Status ownership:**
- **Section 6 defines operational stages**
- **Section 22 defines strict allowed transitions**

### 6.22 Open / To-Be-Confirmed Lifecycle Items

- straight-order full-payment requirement within the 3-day period
- whether a separate **Paid in Full** state is required
- exact category wording and eligibility for the ₱1,000 non-brand-new / subasta / factory-item DP rule
- how the layaway fee is applied to balance/installments
- exact 2nd-miner priority time window
- exact forfeited-item disposition involving the financer
- exact Owner approval mechanism
- invoice-revision workflow
- execution of Section 4–5 reconciliation
- Android/iOS capture technical validation

### 6.23 Section 6 Summary

The complete lifecycle runs from captured mine through confirmation, invoicing, payment/deposit, fulfillment, and completion — with clear off-path handling for withdrawal, cancellation, expiry, layaway, forfeiture, and stock return. Key reinforcements:

- **Capture does not confirm.**
- **Confirmation does not invoice.**
- **Approve & Send Invoice creates/sends the invoice and creates the Official System Order.**
- **Required payment/deposit verification does not always mean fully paid.**
- **Normal release is operational** (permission-based admin/fulfillment staff).
- **Exceptional release requires Owner approval.**
- **Unique-item and multi-stock paths remain separate.**

Section 6 defines the operational stages; **Section 22 will define the strict allowed transitions**, and the items in 6.22 remain **To be confirmed** rather than assumed.

---

*End of Section 6 — Complete Order Lifecycle. **APPROVED.** Section 7 — Dashboard Workflow follows.*

---

## Section 7 — Dashboard Workflow

### 7.1 Purpose of the Dashboard Workflow Section

The dashboard is the **operational command center** and **work-queue hub** of Version 1 (MineFlow). Its job is to let each user see what needs action now and go straight to it.

- It is **action-focused, not a full analytics platform**.
- It **surfaces the lifecycle queues from Section 6** as actionable cards.
- **Visibility is filtered by role, permissions, and operational relevance** (Section 5).
- **Visibility does not automatically grant action authority** — status-changing actions remain gated by the exact required permission.

This section stays business-focused and operational. It does not discuss database schema, APIs, hosting, code, or implementation details. It introduces no new metrics, permissions, rules, alerts, or actions beyond approved Sections 1–6, and it does not silently resolve any To-be-confirmed item.

### 7.2 Shared Dashboard Model

- Version 1 uses **one shared dashboard structure**.
- Cards are **filtered and prioritized by role, assigned permissions, and operational relevance**.
- **Do not create separate dashboard products** for Owner, Selected Admin, and Staff.
- The **Owner sees all cards**.
- **Selected Admin and Staff see only relevant queues**.
- **Action buttons remain permission-gated.**

### 7.3 Queue Visibility Versus Action Authority

**Governing rule:** a user may **see** a queue because it is relevant to their assigned work, but may **perform only the actions allowed by their exact permissions**.

Examples:
- Fulfillment staff may see **Required Payment / Deposit Verified** orders (to prepare fulfillment) but **cannot edit or verify payment**.
- Layaway staff may see **verified layaway deposits** but **cannot verify payment without Payment Verification**.
- **Viewing a queue does not grant status-change authority.**

### 7.4 Owner Dashboard View

- **Full visibility of all operational bands.**
- **Needs Owner Approval is pinned prominently at the top when non-empty** (but it is not the only content).
- **Owner-visibility queues:**
  - Payment Submitted / Unverified
  - Awaiting Required Payment / Deposit
  - Active / Overdue / Grace Layaways
  - Item Monitoring
  - Returned-to-Stock Review
- **Compact summary metrics.**
- **All migrated and new records visible where applicable.**

### 7.5 Selected Admin Dashboard View

- **Operational cards based on permissions.**
- **Normal fulfillment approval queues.**
- May **initiate high-risk actions only if Initiate High-Risk Action is enabled**.
- **High-risk requests route to Needs Owner Approval.**
- **No authority to approve their own high-risk action.**
- **Existing / Migrated Records management only if the migration permission is enabled.**

### 7.6 Staff Dashboard View

- Staff see **only operational queues relevant to their assigned permissions**.
- A card with **no operational relevance does not appear**.
- **Actions inside visible cards remain permission-gated.**
- Staff **cannot see Owner-only approval actions** unless a view is required for an action they initiated — and they **still cannot approve it**.

### 7.7 Dashboard Operational Bands

**A. Live & Claims**
- Pending Claims / Needs Review
- Confirmed Claims / For Invoice
- 2nd-Miner / Waitlist Needs Staff Review

**B. Invoicing**
- Invoices Ready for Review

**C. Payments**
- Awaiting Required Payment / Deposit
- Payment Submitted / Unverified
- Required Payment / Deposit Verified

**D. Reminders**
- Day 1
- Day 2
- Day 3 Final

**E. Layaway**
- Active Layaways
- Layaway Overdue / Grace Period
- Forfeiture-Eligible

**F. Fulfillment**
- For Preparation
- For Shipping
- For Pickup
- Approved for Release

**G. Attention / Exception**
- Exceptional Release / Needs Owner Approval
- Returned-to-Stock Review
- Expired Orders
- Cancelled Orders

**H. Records**
- Existing / Migrated Records
- Possible Duplicate Customers

**I. Search & Quick Actions**

### 7.8 Role and Permission Queue Matrix

**Governing principle:** visibility follows operational relevance; the main action inside a card is gated by the exact permission. The **Owner** sees all cards and may perform all actions. A **Selected Admin** sees the bands their permissions enable and may approve normal fulfillment; high-risk actions may only be **initiated** (never self-approved) and only with the **Initiate High-Risk Action** permission.

| Card / Queue | Visible to (operational relevance) | Main action | Permission to perform |
|---|---|---|---|
| Pending Claims / Needs Review | Claim Capture, Claim Review | Review; confirm | Review requires **Claim Review**; confirmation requires **Confirm Claim & Print Label** |
| Confirmed Claims / For Invoice | Invoice Preparation | Prepare / group claims for invoice | **Invoice Preparation** |
| Invoices Ready for Review | Invoice Preparation | Review grouped invoice / Approve & Send Invoice | **Invoice Preparation** |
| Awaiting Required Payment / Deposit | Payment Verification, Layaway Monitoring, Shipping / Pickup Preparation | (waiting state — no direct status-changing action) | — |
| Payment Submitted / Unverified | Payment Verification | Verify payment | **Payment Verification** |
| Required Payment / Deposit Verified | Shipping / Pickup Preparation, Layaway Monitoring, Payment Verification | Prepare fulfillment | **Shipping / Pickup Preparation**; **payment cannot be edited without Payment Verification** |
| Reminders (Day 1 / 2 / 3 Final) | Reminder Handling | Send / record reminder | **Reminder Handling** |
| Active / Overdue Layaways | Layaway Monitoring | Monitor / record | **Layaway Monitoring**; **payment verification still requires Payment Verification** |
| Forfeiture-Eligible | Layaway Monitoring, Owner | Initiate / approve forfeiture | Initiation requires **Initiate High-Risk Action**; **approval requires Owner** |
| For Preparation / Shipping / Pickup / Approved for Release | Shipping / Pickup Preparation | Prepare / approve normal release | **Shipping / Pickup Preparation** |
| Exceptional Release / Needs Owner Approval | Owner; initiating Selected Admin (status view) | Approve or reject | **Owner** approves/rejects; initiation requires **Initiate High-Risk Action** |
| Expired / Cancelled / Returned-to-Stock | Inventory Monitoring, Owner (where relevant) | Return-to-stock review | **Inventory Monitoring**; **cancellation still follows high-risk authority** |
| 2nd-Miner / Waitlist Needs Staff Review | Miner / Allocation Review, Claim Review | Sure-buyer check & allocate | **Miner / Allocation Review** |
| Existing / Migrated Records management | Owner; Existing Record Entry / Migration holders | Add / migrate record | **Existing Record Entry / Migration** |
| Possible Duplicate Customers | Owner; Existing Record Entry / Migration holders | Review duplicates | Existing Record Entry / Migration; **no automatic merge** |
| Summary Metrics | View Reports holders | (read-only compact counts) | **View Reports** — operational queue counts do **not** require View Reports when the queue is part of the user's duty |

### 7.9 Priority Work Queues

Urgency order (visibility still depends on role and permissions):

1. Needs Owner Approval
2. 2nd-Miner / Waitlist Needs Staff Review
3. Day 3 Final Reminders
4. Payment Submitted / Unverified
5. Confirmed Claims / For Invoice
6. Forfeiture-Eligible
7. For Preparation / Approved for Release
8. Returned-to-Stock Review
9. Possible Duplicate Customers

**Visibility still depends on role and permissions** — a user sees a priority queue only when it is operationally relevant to them.

### 7.10 Dashboard Count Definitions

Each operational count is a **queue size** tied to a Section 6 stage:

- **Pending Claims / Needs Review** — captured claims at the Raw Claim layer awaiting initial review.
- **Confirmed Claims / For Invoice** — individual confirmed claims not currently included in an active invoice draft.
- **Invoices Ready for Review** — prepared buyer-level invoice drafts / grouped claim sets awaiting Approve & Send Invoice. **The same claim must not be counted in both queues at the same time:** once a claim is added to an active invoice draft it no longer counts in Confirmed Claims / For Invoice; if the draft is rejected, dissolved, or the claim is removed before sending, the claim may return to Confirmed Claims / For Invoice. (Strict transition behavior is defined in Section 22.)
- **Awaiting Required Payment / Deposit** — official orders in hold with no payment yet.
- **Payment Submitted / Unverified** — payments received, not yet verified.
- **Required Payment / Deposit Verified** — the required amount is verified (not necessarily Paid in Full).
- **Day 1 / Day 2 / Day 3 Reminders** — orders in hold at each reminder day.
- **Active Layaways** — layaways currently active.
- **Layaway Overdue / Grace Period** — overdue layaways within the 10-day grace.
- **Forfeiture-Eligible** — layaways past grace, awaiting Owner decision.
- **For Preparation** — orders being prepared/checked.
- **For Shipping** — orders at the shipping stage.
- **For Pickup** — orders at the pickup stage.
- **Approved for Release** — releases approved, awaiting dispatch/handover.
- **Needs Owner Approval** — exceptional/high-risk items pending the Owner.
- **Expired Orders** — orders whose hold lapsed without required payment/deposit.
- **Cancelled Orders** — orders in the cancelled terminal state.
- **Returned-to-Stock Review** — items awaiting stock-return review.
- **2nd-Miner / Waitlist Needs Staff Review** — freed items needing a sure-buyer check.
- **Existing / Migrated Records** — migrated records (flagged).
- **Possible Duplicate Customers** — customers flagged for duplicate review.

**Distinguish these metrics:**
- **Total Claims**
- **Total Official Orders**
- **Active Layaways**
- **Completed Orders**
- **Cancelled Orders**
- **Expired Orders**

**Counting rules (per Section 6.20):**
- **Claims are not orders.**
- **Migrated claim-less records do not count as claims.**
- **Migrated historical orders count as official orders.**
- **Active layaways may already be included within total official orders and must not be added again as extra orders** (the metrics are not additive).

### 7.11 Alerts and Attention Flags

**Owner alerts:**
- Needs Owner Approval
- Forfeiture-Eligible

**Time-sensitive:**
- Day 3 Final Reminder
- hold expiring today
- layaway due / grace boundary

**Review-needed:**
- 2nd-Miner / Waitlist Needs Staff Review
- Returned-to-Stock Review
- Possible Duplicate Customers

**Exception:**
- Exceptional Release

Alerts **link to their operational queue**. They are **in-app attention flags only**. **Section 26 owns notification delivery.**

### 7.12 Migrated-Record Visibility

- Migrated records **appear in operational queues based on their actual status**.
- A migrated **Active Layaway** appears in **Active Layaways**.
- A migrated **overdue record** appears in **Layaway Overdue / Grace**.
- A migrated **pickup record** appears in **fulfillment** if action is still needed.
- The **source marker remains visible everywhere** the record appears.
- **Operational users do not need migration-entry permission merely to see migrated records relevant to their duty.**
- The **management card remains restricted to migration-capable users** (Owner and Existing Record Entry / Migration holders).

### 7.13 Search and Quick Actions

**Search entry supports:**
- complete customer name
- Facebook name
- claim/reference number
- official order number
- invoice number
- item code
- shipping number

**Detailed search/filter rules belong to Section 23.**

**Quick actions (permission-gated):**
- Review Claim
- Confirm Claim & Print Label
- Approve & Send Invoice
- Verify Payment
- Send / Record Reminder
- Prepare Item
- Approve Normal Release
- Initiate High-Risk Action
- Add Existing / Migrated Record

### 7.14 Dashboard Refresh Behavior

For Version 1:
- **refresh on page load**;
- **refresh affected queues/counts after completed actions**;
- include a **manual Refresh action**;
- **do not promise real-time or near-live synchronization.**

### 7.15 Dashboard Summary Metrics Boundary

The dashboard may show **compact summary counts only**:
- Total Official Orders
- Active Layaways
- Completed Orders
- Cancelled Orders
- Expired Orders
- **Outstanding Balance — only after it is properly defined** (see 7.18)

**Detailed trends, charts, exports, and performance analysis belong to Section 25.**

**Operational queue counts do not require View Reports** when part of the user's assigned duty.

### 7.16 Possible Duplicate Customer Workflow Entry

- The attention card **appears prominently only when one or more possible duplicates exist**.
- **Authorized users may still open the review page when the count is zero.**
- **No automatic merge.**
- The **exact merge workflow belongs to later customer/search sections**.

### 7.17 Section Boundaries

- **Section 7** owns dashboard workflow and operational queues.
- **Section 22** owns strict status transitions.
- **Section 23** owns detailed search and filters.
- **Section 25** owns reporting and analytics.
- **Section 26** owns notification and reminder delivery.

### 7.18 Open / To-Be-Confirmed Dashboard Items

- formal definition of **Outstanding Balance**
- **straight-order payment labeling** until the full-payment rule is confirmed
- whether **Customer Support** permission also grants duplicate-review access

### 7.19 Section 7 Summary

- **One shared filtered dashboard** — not three separate products.
- **Operational queues by role and permission.**
- **Visibility does not equal action authority.**
- **Migrated records remain operationally visible** (with their source marker).
- **High-risk approval stays with the Owner.**
- **Compact counts only, not full reporting** (Section 25 owns reporting).

---

*End of Section 7 — Dashboard Workflow. **APPROVED.** Section 8 — Screen Map follows.*

---

## Section 8 — Screen Map

### 8.1 Purpose of the Screen Map Section

This section defines, for Version 1 (MineFlow):

- the **major screens** of the application;
- **what each screen is for**;
- **who may access it**;
- its **primary actions**;
- **how users move between screens**.

**Screen visibility is filtered by role, permissions, and operational relevance, while action buttons remain permission-gated** (Section 7.3). A user may see a screen or queue relevant to their duties, but may perform only the actions their exact permissions allow.

This section stays business-focused, structural, and mobile-first. It does not discuss database schema, APIs, hosting, code, or technical implementation details. It introduces no new screens, roles, actions, business rules, permissions, or technical behavior beyond approved Sections 1–7, and it does not silently resolve any To-be-confirmed item.

### 8.2 Application Navigation Model

- **One shared application structure** (not separate products per role).
- **Mobile-first navigation.**
- **Five primary bottom-navigation items:**
  - Dashboard
  - Live
  - Claims
  - Orders
  - More
- **Global Search** is available from the **header or persistent entry** (not a sixth bottom-nav item).
- **Login exists outside authenticated navigation.**
- **Navigation items and screens render based on role and permissions.**

### 8.3 Dashboard Navigation Group

**Dashboard**

- **Purpose:** operational command center; work queues; compact summary counts; alerts and quick actions.
- **Primary users:** all authenticated staff, filtered by permissions.
- **Links to:** all operational queues and detail screens.

### 8.4 Live Navigation Group

**A. Live Batches**
- **Purpose:** list and open live-selling batches.
- **Primary permissions:** Live Batch Item Entry; Claim Capture.
- **Main actions:** open batch; create batch.
- **Links:** Live Batch Detail.

**B. Live Batch Detail**
- **Purpose:** show the items and claims associated with one Live Batch.
- **Main actions:** add item; review available items; set or switch Current Flex Item; open batch claims.
- **Links:** Quick Add Item; Current Flex Item; Pending Claims; Mobile Capture Entry.

**C. Quick Add Item**
- **Purpose:** fast item entry.
- **Required fields:** item code; grams per piece; quantity; required item photo; total price per piece.
- **Primary permission:** Live Batch Item Entry.

**D. Current Flex Item**
- **Purpose:** show and control the item currently being presented during the Live; serve as the item-data source when a claim is captured.
- **Main actions:** set current item; switch current item; clear current item where appropriate.
- *Item-matching transition rules are not defined here.*

**E. Mobile Capture Entry**
- **Purpose:** receive or initiate captured mine-comment evidence; create a Pending Claim / Needs Review record.
- **Android:** planned floating **Capture Claim** entry, subject to technical validation.
- **iOS Version 1:** screenshot → Share → Send to MineFlow.
- **Rules:** capture does not confirm; capture does not print; capture does not send an invoice; item details come from the Current Flex Item; full platform behavior is deferred to **Sections 12, 13, 20, and 24**.

### 8.5 Claims Navigation Group

**A. Pending Claims**
- **Purpose:** Raw Claims waiting for initial review.
- **Primary permissions:** Claim Capture; Claim Review.
- **Main action:** open Claim Review.

**B. Claim Review**
- **Purpose:** review and correct the captured claim.
- **Shows access to:** buyer details; mine comment/reference; mine date and time; screenshot/frame; assigned item; item photo; grams; total item price; claim position / allocation status; duplicate/repeated-claim warning where applicable.
- **Main actions (permission-gated):** edit buyer details; correct item; review miner/allocation position; withdraw claim; switch item; reject capture; Confirm Claim & Print Label; initiate price override request where permitted.
- **2nd-Miner / Waitlist Needs Staff Review destination (active claims):** when the allocation issue relates to an **active Pending or Confirmed Claim**, the dashboard queue opens **Claim Review** and focuses the user on the **miner/allocation section**; allocation actions require **Miner / Allocation Review**.
- **Confirm Claim & Print Label creates a Confirmed Claim and claim/reference number only. It does not create or send an invoice.**

**C. Confirmed Claims / For Invoice**
- **Purpose:** show individual confirmed claims **not currently included in an active invoice draft**.
- **Main action:** prepare or group claims for invoice.
- **Primary permission:** Invoice Preparation.

**D. Invoice Drafts**
- **Purpose:** show buyer-level invoice drafts or grouped claim sets.
- **Rules:** grouped claims must share the same approved payment and fulfillment arrangement; one claim cannot appear simultaneously in For Invoice and an active invoice draft; claims removed from an unsent draft may return to For Invoice.
- **Main actions:** build draft; edit draft; remove claim; dissolve draft; open Invoice Review.

**E. Invoice Review**
- **Purpose:** final staff review before invoice creation and sending.
- **Main action:** Approve & Send Invoice.
- **On successful send:** creates **one Official System Order**; generates **one official order number**; generates **one invoice number**; starts the **shared 3-day hold**; included claims **retain their claim/reference numbers**.

### 8.6 Orders Navigation Group

**A. Official Orders**
- **Purpose:** list official system orders.
- **Visibility:** based on operational relevance and permissions.
- **Main action:** open Order Detail.

**B. Order Detail — Central Transaction Hub**

**Order Detail is the central record and main transaction hub.**

It provides access to:
- included claims/items
- invoice details
- required payment/deposit status
- payment history
- layaway information
- fulfillment information
- reminders
- lifecycle status
- approval or exception status
- migrated/source marker where applicable

It links to specialized work views: **Payment Review**, **Layaway Detail**, and **Fulfillment Detail**. These specialized views operate on the **same transaction and must not create duplicate transaction records**.

### 8.7 Payments Screens

**A. Payments**
- **Purpose:** show payment-related queues:
  - Awaiting Required Payment / Deposit
  - Payment Submitted / Unverified
  - Required Payment / Deposit Verified
- **Visibility:** based on operational relevance.
- **Actions:** open Payment Review.

**B. Payment Review**
- **Purpose:** compare submitted payment information with the related invoice/order; verify the required payment or deposit.
- **Primary permission:** Payment Verification.
- **Clarification:** **Required Payment / Deposit Verified does not automatically mean Paid in Full.** Do not display Paid in Full unless the full-balance rule and status are formally approved later.

### 8.8 Layaway Screens

**A. Layaway**
- **Purpose:** queues for Active Layaway; Layaway Overdue; Grace Period; Forfeiture-Eligible.
- **Primary permission:** Layaway Monitoring.

**B. Layaway Detail**
- **Purpose:** focused view of one layaway record.
- **Shows:** item/order; customer; total item price; down payment; payments received; remaining balance; term; start/due dates; grace status; financer; migrated marker where applicable.
- **Actions:** record or monitor installment; open payment verification where authorized; initiate forfeiture request.
- **Owner approval remains required for forfeiture.**

### 8.9 Fulfillment Screens

*One combined top-level area — no separate top-level Shipping and Pickup screens.*

**A. Fulfillment**
- **Tabs / filters / queues for:** For Preparation; For Shipping; For Pickup; Approved for Release; Dispatched; Picked Up / Completed where relevant.
- **Primary permission:** Shipping / Pickup Preparation.

**B. Fulfillment Detail**
- **Purpose:** focused shipping or pickup work view for one transaction.
- **Shows as relevant:** customer; order; payment/deposit verification state; preparation status; shipping or pickup arrangement; courier/tracking/reference; receiver details; release status; exception status.
- **Normal release:** operational and permission-based.
- **Exceptional release:** routes to Owner Approvals.

### 8.10 Inventory Screens

**A. Inventory**
- **Purpose:** item and stock monitoring for unique and multi-stock items.
- **Primary permission:** Inventory Monitoring.
- **Links to:** Live Batch item; associated claims/orders; Returned-to-Stock Review.

**B. Returned-to-Stock Review**
- **Purpose:** handle items from withdrawn claims, approved cancellations, and expired unpaid orders.
- **Rules:** unique item checks recorded 2nd miner; multi-stock checks next eligible waitlist buyer; staff review required; no automatic transfer; forfeited layaway items are excluded from automatic stock return.
- **2nd-Miner / Waitlist Needs Staff Review destination (freed items):** when an item becomes available because of withdrawal, approved cancellation, or an expired unpaid order, the dashboard queue opens **Returned-to-Stock Review**, which shows the **recorded 2nd miner** for a unique item or the **next eligible waitlist buyer** for multi-stock, requires a **staff sure-buyer review**, and **does not automatically transfer or allocate the item**.

### 8.11 Customer Screens

**A. Customers**
- **Purpose:** staff-managed customer list.
- **Primary access:** Customer Support and other operationally relevant users.
- **Main action:** open Customer Profile / History.

**B. Customer Profile / History**
- **Purpose:** combined view of migrated and new customer records.
- **Shows:** customer identity details; total claims; official orders; active layaways; completed orders; cancelled orders; expired orders; payments; outstanding balance only once formally defined; shipping/pickup history; notes; source markers.
- **States:** claims are not orders; migrated claim-less records do not count as claims; active layaways may already be included in official orders and are not additive.
- **Customers do not log in.**

### 8.12 Existing and Migrated Record Screens

**A. Existing / Migrated Records**
- **Purpose:** management list of historical/manual records.
- **Access:** Owner; users with Existing Record Entry / Migration.

**B. Add Existing Layaway / Migrate Record**
- **Purpose:** manually enter historical records.
- **Rules:** historical values and dates are preserved; current deposit rules are not applied retroactively; item photo is optional if unavailable; source marker is required; manual entry is Version 1; CSV/Excel import is deferred.
- **Links:** Customer Profile / History; Layaway Detail; Order Detail where applicable.

### 8.13 Possible Duplicate Customer Screen

- **Purpose:** review possible duplicate profiles.
- **Access:** Owner; users with Existing Record Entry / Migration; Customer Support may see a warning only, not merge or confirm duplicates solely from Customer Support permission.
- **Rules:** no automatic merge; exact merge workflow deferred; attention card appears prominently only when duplicates exist.

### 8.14 Owner and Administrative Screens

**A. Owner Approvals**
- **Purpose:** Owner approval queue for official-order cancellation; forfeiture; price override; exceptional release.
- **Access:** Owner approves/rejects; initiating Selected Admin may view their request status but cannot approve.

**B. User Accounts / Permissions**
- **Access:** Owner only.
- **Actions:** create account; edit account; disable account; assign roles; assign permission toggles.
- Includes the future reconciliation need for the **Existing Record Entry / Migration** permission.

**C. Settings**
- **Access:** Owner.
- **V1 scope may include:** business/system name; basic business details; invoice display details; label/printing preferences; approved reminder defaults; printer/device setup entry; other confirmed operational defaults.
- **Exact fields remain To be confirmed.** Do not invent broad configuration options.

### 8.15 Reports Screen

A dedicated **basic** Reports screen in Version 1.

- **Access:** View Reports.
- **May show:** compact totals; date-range selection; order-status summary; payment summary; layaway summary.
- **Detailed analytics, charts, performance analysis, exports, and final report definitions belong to Section 25.**

### 8.16 Search Results Screen

Global Search supports entry by:
- complete customer name
- Facebook name
- claim/reference number
- official order number
- invoice number
- item code
- shipping number

- **Search results must respect role and permission visibility.**
- **Detailed query, filter, ranking, and result behavior belongs to Section 23.**

### 8.17 Print Queue / Reprint Screen

- **Purpose:** show pending, successful, failed, or reprint-related label activity where applicable.
- **Placement:** accessible from Claim Review; the Claims or Live area; the More menu; a print-status shortcut when pending/failed work exists.
- **It is not a primary bottom-navigation item.**
- **Detailed permissions, reprint rules, duplicate warnings, and failed-print behavior belong to Section 24.**

### 8.18 Login and Account Recovery Entry

- individual staff login;
- no shared credentials;
- Owner-managed user accounts;
- disabled accounts cannot sign in;
- account/password recovery entry;
- customers have no login.

**Exact authentication, recovery, and security implementation are deferred to later technical/security sections.**

### 8.19 Screen-to-Screen Relationship Summary

**Live path:**
```
Login
→ Dashboard
→ Live Batches
→ Live Batch Detail
→ Current Flex Item / Mobile Capture Entry
→ Pending Claims
→ Claim Review
→ Confirmed Claims / For Invoice
→ Invoice Draft
→ Invoice Review
→ Approve & Send Invoice
→ Official Order
→ Order Detail
```

**Payment path:**
```
Order Detail
→ Payment Review
→ Required Payment / Deposit Verified
→ Order Detail / Layaway / Fulfillment
```

**Layaway path:**
```
Order Detail
→ Layaway Detail
→ Active / Overdue / Grace / Forfeiture-Eligible
→ Owner Approvals where required
```

**Fulfillment path:**
```
Order Detail or Dashboard queue
→ Fulfillment
→ Fulfillment Detail
→ Approved for Release
→ Completed
```

**Migration path:**
```
More
→ Existing / Migrated Records
→ Add Existing Layaway / Migrate Record
→ Customer Profile / Layaway Detail / Order Detail
```

**Approval path:**
```
Source screen
→ Owner Approvals
→ approve/reject
→ return to source record
```

**2nd-Miner / Waitlist review path:**
```
Dashboard queue
→ Claim Review, when the allocation issue belongs to an active claim

or

Dashboard queue / Returned-to-Stock Review
→ sure-buyer or waitlist review
→ staff-reviewed allocation outcome
```

*Strict allocation and status transitions remain owned by Section 22. This queue opens within existing screens — it is not a new top-level screen.*

### 8.20 Mobile Navigation and Interaction Rules

- five-item bottom navigation;
- thumb-reachable primary actions;
- Dashboard as the hub;
- list → detail interaction pattern;
- Global Search in header/persistent entry;
- capture entry prioritized in Live;
- permission-filtered navigation;
- high-risk actions must not be exposed as ordinary one-tap actions;
- detailed responsive design belongs to later feature/UI specifications.

### 8.21 Screen Overlap and Boundary Rules

- **Order Detail is the central transaction record.**
- **Payment Review, Layaway Detail, and Fulfillment Detail are focused action views.**
- **They do not create duplicate records.**
- **Fulfillment combines shipping and pickup.**
- **Confirmed Claims / For Invoice and Invoice Drafts remain separate.**
- **Dashboard summaries do not replace Reports.**
- **Search Results does not replace operational list screens.**
- **Print Queue behavior belongs to Section 24.**
- **Status transitions belong to Section 22.**
- **Detailed search belongs to Section 23.**
- **Analytics belongs to Section 25.**
- **Notification delivery belongs to Section 26.**

### 8.22 Open / To-Be-Confirmed Screen Items

- exact Settings fields
- Print Queue visibility and reprint details
- duplicate-customer merge workflow
- Paid in Full labeling
- Outstanding Balance definition
- technical login/recovery/security behavior

### 8.23 Section 8 Summary

- **One shared mobile-first application.**
- **Five primary bottom-nav items** (Dashboard, Live, Claims, Orders, More).
- **Order Detail as the central hub.**
- **One combined Fulfillment area.**
- **Specialized views without duplicate records.**
- **No customer login.**
- **Migrated records supported.**
- **Screen visibility and actions remain permission-controlled.**

---

*End of Section 8 — Screen Map. **APPROVED.** Section 9 — Module Breakdown follows.*

---

## Section 9 — Module Breakdown

### 9.1 Purpose of the Module Breakdown Section

This section defines, for Version 1 (MineFlow):

- the **major functional modules** of Version 1;
- **what each module owns**;
- the **approved screens** inside each module;
- its **business concepts**;
- its **primary users and permissions**;
- its **inputs and outputs**;
- its **boundaries and dependencies**.

**Governing statements:**

- A **module is a functional business area, not one screen**.
- One module may contain **multiple screens**.
- **Module names are not roles.**
- **Module names are not new permission toggles.**
- **Exact approved Section 5 permissions control access and actions.**
- **Visibility does not equal action authority.**

This section stays business-focused and product-architectural. It does not discuss database tables, API endpoints, hosting, source-code folders, frameworks, implementation code, unapproved integrations, or detailed transition logic. It invents no modules, screens, roles, permissions, records, actions, statuses, or technical behavior beyond approved Sections 1–8, and it does not silently resolve any To-be-confirmed item.

### 9.2 Module Classification

**Operational modules:**

- A. Authentication and Access
- B. Dashboard and Work Queues
- C. Live Selling and Batch Management
- D. Claim Capture
- E. Claim Review and Allocation
- F. Invoice Preparation
- G. Official Order Management
- H. Payment Management
- I. Layaway Management
- J. Fulfillment Management
- K. Inventory and Item Availability
- L. Customer Management
- M. Existing Record Migration
- N. Owner Approvals

**Cross-cutting modules/services:**

- O. Printing and Reprint
- P. Search
- Q. Reporting
- R. Notifications and Reminders
- S. User Accounts and Permissions
- T. Settings
- U. Audit and Accountability

**Owner Approvals is operationally cross-module** because it receives high-risk requests from several modules.

### 9.3 Authentication and Access Module

**Purpose:**
- control entry to the system;
- enforce role and permission access;
- block disabled accounts.

**Screens:** Login; account/password recovery entry.

**Business concepts:** staff account; authenticated user; role; permission enforcement; disabled account.

**Main actions:** sign in; open recovery entry; deny access to disabled accounts.

**Inputs:** user accounts, roles, and permission toggles from User Accounts and Permissions.

**Outputs:** authenticated identity to every module; staff identity for audit attribution.

**Boundaries:**
- does not create or edit accounts;
- does not define technical authentication or security implementation;
- customers have no login.

### 9.4 Dashboard and Work Queues Module

**Purpose:**
- operational command center;
- surface queues, counts, alerts, and quick actions.

**Screen:** Dashboard.

**Business concepts:** operational queue; queue count; compact summary; attention flag; refresh behavior.

**Actions:** open queue; use permission-gated quick action; manual Refresh.

**Inputs:** queue states from operational modules.

**Outputs:** navigation into the owning module.

**Boundaries:**
- Dashboard does not own the underlying record;
- Dashboard does not define status transitions;
- compact operational counts do not replace Reporting;
- alerts do not define delivery behavior.

### 9.5 Live Selling and Batch Management Module

**Screens:** Live Batches; Live Batch Detail; Quick Add Item; Current Flex Item.

**Purpose:**
- prepare and operate a live-selling batch;
- manage items being flexed.

**Business concepts:** Live Batch; batch item; Current Flex Item.

**Required item fields:**
- item code
- grams per piece
- quantity
- required item photo
- total price per piece

**Primary permissions:** Live Batch Item Entry; Claim Capture where viewing batch claims is operationally relevant.

**Actions:** create/open batch; add item; set/switch/clear Current Flex Item.

**Inputs:** item availability and quantity visibility from Inventory.

**Outputs:** Current Flex Item to Claim Capture; item records to Inventory.

**Boundaries:**
- does not create claims;
- does not review claims;
- does not own item availability changes after claims and orders exist.

### 9.6 Claim Capture Module

**Screen:** Mobile Capture Entry.

**Purpose:**
- receive captured mine-comment evidence;
- create a Pending Claim / Needs Review record.

**Business concepts:** screenshot/frame evidence; Pending Claim; Current Flex Item association.

**Primary permission:** Claim Capture.

**Actions:** capture or receive evidence; create Pending Claim.

**Inputs:** Current Flex Item from Live Selling and Batch Management.

**Outputs:** Pending Claim to Claim Review and Allocation.

**Rules:**
- capture never confirms;
- capture never prints;
- capture never sends an invoice;
- Android capture remains subject to technical validation;
- iOS V1 uses screenshot → Share → Send to MineFlow.

**Boundaries:**
- does not correct, confirm, allocate, print, or invoice;
- technical platform behavior belongs to later sections.

### 9.7 Claim Review and Allocation Module

**Screens:** Pending Claims; Claim Review; active-claim 2nd-Miner / Waitlist review inside Claim Review.

**Purpose:**
- convert a Raw Claim into a Confirmed Claim after authorized review.

**Business concepts:** Raw Claim; Confirmed Claim; claim/reference number; item correction; miner position; multi-stock allocation; waitlist; withdrawal; rejected capture; active-claim sure-buyer review.

**Primary permissions:** Claim Review; Item Correction; Miner / Allocation Review; Confirm Claim & Print Label; Initiate High-Risk Action for price-override requests only.

**Actions:** review claim evidence; edit buyer details; correct item; review miner/allocation position; withdraw claim; switch item; reject capture; Confirm Claim & Print Label; initiate price-override request.

**Inputs:** Pending Claims from Claim Capture; item data from Live Selling; item availability and quantity visibility from Inventory.

**Outputs:** Confirmed Claims to Invoice Preparation; label job to Printing and Reprint; withdrawn-item outcome to Returned-to-Stock Review; price-override request to Owner Approvals.

**Confirm Claim & Print Label creates a Confirmed Claim and claim/reference number only. It does not create or send an invoice.**

**Returned-to-stock boundary:**
- withdrawal sends the affected item to Returned-to-Stock Review;
- it does not immediately return to general availability;
- no automatic transfer or allocation occurs.

**Boundaries:**
- does not prepare invoices;
- does not create Official Orders;
- does not approve price overrides;
- does not own freed-item review after the item enters Returned-to-Stock Review.

### 9.8 Invoice Preparation Module

**Screens:** Confirmed Claims / For Invoice; Invoice Drafts; Invoice Review.

**Purpose:**
- group complete claims for one buyer and arrangement;
- prepare and send the approved invoice.

**Business concepts:** individual For-Invoice claim; buyer-level invoice draft; grouped claim set; payment arrangement; fulfillment arrangement; Approve & Send Invoice.

**Primary permission:** Invoice Preparation.

**Actions:** prepare/group claims; build/edit/dissolve invoice draft; add/remove claim; review grouped invoice; Approve & Send Invoice.

**Inputs:** Confirmed Claims from Claim Review; customer identity from Customer Management.

**Outputs — after successful send:**
- one Official System Order
- one official order number
- one invoice number
- shared 3-day hold
- included claims retain their claim/reference numbers

**Rules:**
- grouped claims must have the same payment and fulfillment arrangement;
- one claim cannot count in For Invoice and an active invoice draft at the same time;
- a removed or dissolved unsent claim may return to For Invoice.

**Boundaries:**
- invoice draft is not an Official Order;
- unsuccessful or dissolved drafts do not create an order;
- invoice-revision workflow remains To be confirmed.

### 9.9 Official Order Management Module

**Screens:** Official Orders; Order Detail.

**Purpose:**
- own the Official System Order;
- provide the central transaction hub.

**Business concepts:** Official System Order; official order number; invoice number; shared hold; lifecycle visibility; approval/exception visibility; migrated/source marker.

**Actions:** open and monitor order; view claims/items; view invoice; view payment/deposit state; view payment history; view layaway information; view fulfillment information; view reminders; navigate to specialized work views.

**Inputs:** new orders from Invoice Preparation; historical orders from Existing Record Migration; updates from Payment, Layaway, Fulfillment, Owner Approvals.

**Outputs:** order context to Payment, Layaway, Fulfillment, Reminders, Reporting, Customer History; hold timing to Notifications and Reminders; expired or approved-cancelled item outcome to Returned-to-Stock Review.

**Returned-to-stock boundary:**
- expiry or approved cancellation does not immediately return the item to stock;
- the item first enters Returned-to-Stock Review;
- no automatic transfer or allocation occurs.

**Boundaries:**
- does not verify payments;
- does not manage installment schedules;
- does not perform fulfillment;
- does not approve cancellation;
- specialized views operate on the same transaction and create no duplicate records.

### 9.10 Payment Management Module

**Screens:** Payments; Payment Review.

**Purpose:**
- monitor and verify required payments and deposits.

**Business concepts:** Awaiting Required Payment / Deposit; Payment Submitted / Unverified; Required Payment / Deposit Verified; payment history; payment verification.

**Primary permission:** Payment Verification.

**Actions:** review submitted payment; verify required payment/deposit; view payment history.

**Inputs:** Official Order and arrangement context; installment context from Layaway where applicable.

**Outputs:** verified state to Official Order, Layaway, and Fulfillment; verification attribution to Audit.

**State:**
- Required Payment / Deposit Verified does not automatically mean Paid in Full;
- Paid in Full remains To be confirmed.

**Boundaries:**
- does not own layaway schedule;
- does not approve fulfillment release;
- does not define Paid in Full status.

### 9.11 Layaway Management Module

**Screens:** Layaway; Layaway Detail.

**Purpose:**
- monitor active layaways, installments, overdue/grace state, forfeiture eligibility, and financer attribution.

**Business concepts:**
- minimum 20% down payment
- maximum three-month term
- fee formula: ₱150 × grams × months
- exact fee application remains To be confirmed
- maximum 10-day grace period
- financer
- active layaway
- overdue
- grace
- forfeiture-eligible
- migrated layaway

**Primary permissions:** Layaway Monitoring; Payment Verification for payment verification; Initiate High-Risk Action for forfeiture request.

**Actions:** monitor schedule; record installment activity; open payment verification; monitor due/grace boundary; initiate forfeiture request.

**Inputs:** Official Order; verified payment/deposit from Payment Management; migrated layaway from Existing Record Migration.

**Outputs:** balance/status context to Official Order, Customer History, Reporting; reminder timing to Notifications and Reminders; forfeiture request to Owner Approvals.

**Boundaries:**
- installment recording does not equal payment verification;
- forfeiture approval belongs to Owner Approvals;
- forfeited-item disposition remains To be confirmed;
- forfeited items do not automatically enter Returned-to-Stock Review.

### 9.12 Fulfillment Management Module

**Screens:** Fulfillment; Fulfillment Detail.

**Purpose:**
- prepare verified orders for shipping or pickup;
- support normal release;
- route exceptional release requests to the Owner.

**Business concepts:** For Preparation; For Shipping; For Pickup; Approved for Release; Dispatched; Picked Up / Completed where relevant; normal release; exceptional release; courier/tracking/reference; receiver details.

**Primary permissions:** Shipping / Pickup Preparation; Initiate High-Risk Action for exceptional-release request.

**Actions:** prepare item; approve normal release; record dispatch; record handover/pickup; initiate exceptional-release request.

**Inputs:** Official Order; Required Payment / Deposit Verified context.

**Outputs:** fulfillment outcome to Official Order, Customer History, Inventory; exceptional-release request to Owner Approvals; cancelled or exited fulfillment item outcome to Returned-to-Stock Review.

**Returned-to-stock boundary:**
- Fulfillment performs no stock return;
- an item leaving fulfillment because of an approved cancellation or other reviewed exit enters Returned-to-Stock Review;
- no automatic stock return, transfer, or allocation occurs.

**Boundaries:**
- does not verify payment;
- does not approve exceptional release;
- does not own returned-to-stock review.

### 9.13 Inventory and Item Availability Module

**Screens:** Inventory; Returned-to-Stock Review.

**Purpose:**
- monitor item availability and quantity remaining;
- handle staff-reviewed outcomes for withdrawn, cancelled, or expired items.

**Business concepts monitored:**
- item availability
- quantity remaining
- association with claims and orders
- fulfillment outcome
- withdrawal outcome
- cancellation outcome
- expiration outcome
- Returned-to-Stock Review outcome

**Formal inventory status names and strict transitions belong to Section 22.**

**Primary permissions:** Inventory Monitoring; Miner / Allocation Review for allocation decisions during review.

**Actions:** monitor item availability; monitor quantity remaining; open Returned-to-Stock Review; review recorded 2nd miner for unique item; review next eligible waitlist buyer for multi-stock; perform staff sure-buyer review; record reviewed outcome.

**Inputs:** item records from Live Selling; claim/order associations; fulfillment outcomes; withdrawal/cancellation/expiration outcomes.

**Outputs:** availability and quantity visibility to Live Selling and Claim Review; staff-reviewed re-offer candidate to the appropriate new-claim path; reviewed outcome recorded subject to Section 22.

**Rules:**
- unique item: show recorded 2nd miner;
- multi-stock item: show next eligible waitlist buyer;
- staff review is required;
- no automatic return to general availability;
- no automatic transfer to another buyer;
- no automatic allocation;
- staff-reviewed outcome may later return the item to general availability or create the appropriate reviewed next step, subject to Section 22;
- forfeited layaway items are excluded from automatic stock return.

**Boundaries:**
- does not own active-claim allocation;
- does not define formal inventory statuses;
- does not decide forfeited-item disposition.

### 9.14 Customer Management Module

**Screens:** Customers; Customer Profile / History.

**Purpose:**
- maintain one staff-managed customer profile with combined migrated and new history.

**Business concepts:** customer identity; Facebook name; claims; Official Orders; payments; layaways; fulfillment history; customer notes; source markers; duplicate warning; non-additive metrics.

**Primary permissions:** Customer Support; operationally relevant access from other modules.

**Actions:** open profile; maintain allowed customer details; add notes; view history; see duplicate warning.

**Inputs:** claim/order/payment/layaway/fulfillment history; migrated records from Existing Record Migration.

**Outputs:** customer identity to Invoice Preparation; customer data to Search and Reporting where authorized.

**Rules:**
- claims are not orders;
- migrated claim-less records do not count as claims;
- active layaways may already be included in Official Orders and are not additive;
- customers have no login.

**Boundaries:**
- Customer Support warning does not authorize duplicate resolution;
- does not enter migrated records;
- does not own duplicate merge or confirmation.

### 9.15 Existing Record Migration Module

**Screens:** Existing / Migrated Records; Add Existing Layaway / Migrate Record; Possible Duplicate Customers.

**Purpose:**
- manually enter historical records;
- preserve actual values and dates;
- manage the dedicated possible-duplicate review workflow.

**Business concepts:** migrated record; historical order; existing layaway; source marker; duplicate candidate; manual Version 1 entry.

**Primary access:** Owner; users with Existing Record Entry / Migration.

**Existing Record Entry / Migration remains a recorded permission reconciliation and is not silently treated as already added to the approved Section 5 list.**

**Actions:** add existing/migrated record; preserve historical values; review possible duplicates; record migration attribution.

**Rules:**
- no retroactive application of current deposit rules;
- item photo optional if unavailable;
- source marker required;
- manual entry in Version 1;
- CSV/Excel import deferred;
- no automatic merge;
- exact merge workflow deferred.

**Duplicate-review ownership:**
- this module owns the dedicated duplicate-review workflow;
- Customer Management displays the warning only;
- Customer Support permission alone cannot confirm, merge, or resolve duplicates.

**Inputs:** historical data entered by authorized staff.

**Outputs:** historical Official Orders to Official Order Management; migrated layaways to Layaway Management; customer history to Customer Management; ongoing records to operational modules based on actual status; migration attribution to Audit.

**Boundaries:**
- does not continue managing the record after migration;
- operational modules own ongoing work;
- does not perform automatic merging;
- does not perform bulk import in Version 1.

### 9.16 Owner Approvals Module

**Screen:** Owner Approvals.

**Purpose:**
- act as the single high-risk approval gate across modules.

**High-risk actions:**
- official-order cancellation
- forfeiture
- price override
- exceptional release

**Primary permissions:** Owner approves/rejects; Initiate High-Risk Action allows an authorized user to create a request and view its status.

**Rules:**
- initiate → Owner review → approve/reject → return outcome to source module;
- no delegation;
- request waits if Owner unavailable;
- initiator cannot approve their own request;
- normal fulfillment release is not high-risk.

**Inputs:** price-override request from Claim Review; cancellation request from Official Order Management; forfeiture request from Layaway; exceptional-release request from Fulfillment.

**Outputs:** approved/rejected outcome to source module; approval attribution to Audit.

**Boundaries:**
- does not own the underlying record;
- does not perform normal operational release;
- does not automatically execute unrelated downstream actions.

### 9.17 Printing and Reprint Module

**Screen:** Print Queue / Reprint.

**Purpose:**
- manage label activity created after claim confirmation.

**Business concepts:** label job; pending print; successful print; failed print; reprint request.

**Primary permission:** Confirm Claim & Print Label; exact reprint permissions remain deferred to Section 24.

**Inputs:** label job from Claim Review and Allocation.

**Actions:** view print activity; access reprint entry where authorized.

**Rules:**
- no capture event automatically prints;
- no claim confirmation occurs inside the print module;
- detailed reprint, failure, duplicate warning, and retry rules belong to Section 24.

**Boundaries:**
- Claim Review creates the label job;
- Printing does not confirm claims;
- Printing does not invoice.

### 9.18 Search Module

**Screens:** Global Search entry; Search Results.

**Purpose:**
- find records across approved searchable keys.

**Search keys:**
- complete customer name
- Facebook name
- claim/reference number
- Official Order number
- invoice number
- item code
- shipping number

**Rules:**
- results respect role and permission visibility;
- Search does not replace operational list screens;
- detailed query, filter, ranking, and result behavior belongs to Section 23.

### 9.19 Reporting Module

**Screen:** Reports.

**Purpose:**
- provide compact summaries in Version 1.

**Primary permission:** View Reports.

**May show:** compact totals; date-range selection; order-status summary; payment summary; layaway summary.

**State:**
- Outstanding Balance appears only after it is formally defined;
- detailed analytics, charts, exports, performance analysis, and final definitions belong to Section 25;
- dashboard operational counts belong to Dashboard and Work Queues.

### 9.20 Notifications and Reminders Module

**Purpose:**
- manage operational reminder queues and attention flags.

**Scope:**
- Day 1 reminder queue
- Day 2 reminder queue
- Day 3 final reminder queue
- authorized staff may send or record reminders
- in-app attention flags
- timing inputs from order holds and layaway dates

**Primary permission:** Reminder Handling.

**Inputs:** hold timing from Official Order Management; due/grace timing from Layaway.

**Boundaries — do not define or assume:**
- automatic message sending
- any specific messaging platform
- delivery-channel behavior
- delivery confirmation
- retry behavior

**All delivery behavior belongs to Section 26.**

### 9.21 User Accounts and Permissions Module

**Screen:** User Accounts / Permissions.

**Access:** Owner only.

**Purpose:**
- manage staff accounts, roles, and exact permission toggles.

**Actions:** create account; edit account; disable account; assign role; assign approved permission toggles.

**Outputs:** user identity and permission configuration to Authentication and every module.

**Rules:**
- module names are not permission names;
- one module may use several permissions;
- one permission may be relevant to several modules;
- Owner's capabilities come from implicit access to all approved permissions;
- Payment Verification and Existing Record Entry / Migration are not separate Owner-only functions.

Includes the **recorded reconciliation need to add Existing Record Entry / Migration to Section 5**.

### 9.22 Settings Module

**Screen:** Settings.

**Access:** Owner.

**Purpose:**
- provide a limited Version 1 settings entry.

**Scope may include:** business/system name; basic business information; invoice display details; label/printing preferences; approved reminder defaults; printer/device setup entry; other confirmed operational defaults.

**Exact fields remain To be confirmed.** Do not invent broad configuration features.

### 9.23 Audit and Accountability Module

**Purpose:**
- preserve staff attribution and accountability across modules.

**No dedicated Version 1 screen is required.** Audit information may surface inside related records.

**Inputs from all modules may include attribution for:**
- claim edits
- claim confirmation
- payment verification
- migrated-record entry
- high-risk request
- Owner approval/rejection
- other approved staff actions

**Detailed audit requirements belong to Section 31.** Do not invent audit retention, event structure, edit-locking, or technical logging behavior here.

### 9.24 Cross-Module Dependency Summary

**Main operational flow:**
```
Live Selling
→ Claim Capture
→ Claim Review and Allocation
→ Invoice Preparation
→ Official Order Management
→ Payment / Layaway / Fulfillment
→ Completion or Returned-to-Stock Review where applicable
```

**Migration:**
```
Existing Record Migration
→ Official Order / Layaway / Customer Management
→ normal operational modules by actual status
```

**High-risk:**
```
source module
→ Owner Approvals
→ outcome returns to source module
```

**Cross-cutting:**
- Dashboard reads operational queues;
- Search reads permission-filtered records;
- Reporting reads approved summaries;
- Reminders read timing inputs;
- Printing receives label jobs;
- Audit receives staff attribution;
- Accounts and Permissions control access;
- Settings provides approved defaults.

### 9.25 Module Boundary and Duplication Rules

- **Live Selling owns batch/item/current-flex setup; Claim Capture owns Pending Claim creation.**
- **Claim Review ends at Confirmed Claim; Invoice Preparation begins at For Invoice.**
- **Invoice Draft is not an Official Order.**
- **Official Order Management owns the central transaction record.**
- **Payment, Layaway, and Fulfillment are specialized operational modules acting on the same transaction.**
- **Dashboard shows queues but does not own records.**
- **Returned-to-Stock Review must occur before any reviewed re-offer or return to general availability.**
- **Customer Management displays duplicate warning; Existing Record Migration owns duplicate review.**
- **Owner Approvals owns the approval act only.**
- **Reminders do not define delivery mechanics.**
- **Reports do not replace Dashboard queues.**
- **Printing does not confirm claims.**
- **Search does not replace operational lists.**
- **Module names are not roles or permissions.**

### 9.26 Owner-Only and High-Risk Responsibility Summary

**Owner-only:**
- approve/reject high-risk requests
- manage user accounts and permissions
- access Settings
- implicit access to all approved permissions

**High-risk requests:**
- official-order cancellation
- forfeiture
- price override
- exceptional release

**Normal release:**
- permission-based under Fulfillment;
- not an Owner-only high-risk action.

### 9.27 Migrated-Record Behavior Across Modules

- Existing Record Migration creates the record;
- operational modules manage it by actual status;
- users do not need migration-entry permission merely to work on an applicable migrated record;
- source marker visible everywhere;
- historical values and dates preserved;
- migrated layaway counts as one historical Official Order and may also appear in Active Layaways, but metrics are not additive;
- claim-less migrated records do not count as claims;
- forfeited-item disposition and duplicate merge remain To be confirmed.

### 9.28 Open / To-Be-Confirmed Module Items

- invoice-revision workflow
- forfeited-item disposition
- Paid in Full definition/label
- Outstanding Balance definition
- duplicate-customer merge workflow
- detailed audit scope
- execution of the Section 4–5 reconciliation
- formal inventory status naming and transitions
- print/reprint behavior
- notification delivery behavior
- exact Settings fields

### 9.29 Section 9 Summary

- **21 functional modules** — **14 operational** modules and **7 cross-cutting** modules/services.
- **Module names are functional areas, not permissions.**
- **Order Detail remains the central transaction hub.**
- **Specialized modules operate on the same record without duplication.**
- **Migrated records enter normal workflows by actual status.**
- **High-risk approval remains centralized under the Owner.**
- **No automatic return, transfer, allocation, merge, print, or notification behavior is introduced.**

---

*End of Section 9 — Module Breakdown. **APPROVED.** Section 10 — Customer Workflow follows.*

---

## Section 10 — Customer Workflow

### 10.1 Purpose of the Customer Workflow Section

This section defines the complete **staff-managed customer lifecycle** in Version 1 (MineFlow) — from provisional captured identity through:

- profile selection or creation
- claim association
- invoice grouping
- Official Orders
- payment history
- layaway history
- fulfillment history
- migrated records
- duplicate warnings
- notes
- combined long-term history

**Governing facts:**
- **Customers have no account or login.**
- **Staff manage all customer records.**
- **Visibility does not equal action authority.**
- **Customer Management owns identity and combined history, while operational modules own their own transaction actions.**

This section stays business-focused and staff-facing. It does not discuss database tables, API endpoints, code, frameworks, technical authentication, search algorithms, audit implementation details, or duplicate-merge implementation. It invents no customer-facing features, CRM scoring, loyalty programs, marketing automation, unrestricted editing, new permissions, or searchable fields, and it does not silently resolve any To-be-confirmed item.

### 10.2 Governing Customer-Identity Rule

> **Capture collects provisional identity.**
> **Claim Review or Migration resolves the customer association.**
> **Invoice Preparation groups claims already associated with a customer.**

- Provisional information is **not** automatically a permanent customer profile.
- **No OCR, auto-identification, or automatic matching is assumed.**
- **No automatic profile creation or duplicate merge occurs.**

### 10.3 Customer Lifecycle Stages

```
Provisional identity appears
→ staff search during Claim Review or Migration
→ select existing / create new / flag possible duplicate
→ associate the claim or migrated record
→ Confirmed Claim
→ Invoice Draft grouping
→ Official Order
→ payment / layaway / fulfillment
→ combined customer history
```

**Migrated records may enter directly at their verified historical state and bypass capture, claim confirmation, and invoice creation** (see 10.21).

### 10.4 Sources of Provisional Customer Identity

Possible sources:
- captured mine comment
- manual Pending Claim entry
- screenshot evidence
- entered Facebook name
- entered customer name
- Existing Record Migration entry

**Invoice Preparation is NOT a primary customer-profile creation source** — it consumes an association already established on the Confirmed Claim (see 10.14).

### 10.5 Customer Profile Fields at the Business Level

Consider:
- complete customer name
- Facebook name or profile reference
- approved contact information
- approved shipping or pickup information
- source markers
- notes
- possible-duplicate warning

- **Exact required versus optional fields remain To be confirmed.**
- **Exact editable field list remains To be confirmed.**
- **Contact number, email, address, and other contact information are not automatically approved searchable keys.**

### 10.6 Facebook Name Versus Customer Name

- Facebook name and complete customer name are **distinct fields**.
- A Facebook display name is **not** assumed to be the legal or complete customer name.
- Two people may have similar or identical Facebook names.
- Neither field automatically overrides the other.
- **Staff review is required before customer association.**

### 10.7 Search-Before-Create Workflow

At the business level, staff may search using:
- complete customer name
- Facebook name
- an existing customer identifier **only if formally approved later**
- claim/reference number, invoice number, or Official Order number **when entering from an existing transaction**

- **Contact number, email, address, and other contact fields are not yet approved searchable keys.**
- **Whether contact information becomes searchable remains To be confirmed.**
- **Detailed matching, ranking, filtering, and result behavior belong to Section 23.**

### 10.8 Claim Capture Customer Workflow

Claim Capture may collect: Facebook name; entered customer name; mine comment/reference; screenshot evidence; captured date/time.

**Rules:**
- information remains **provisional**;
- capture does **not** create a permanent customer profile;
- capture does **not** automatically identify the buyer;
- capture does **not** resolve duplicates;
- capture does **not** confirm the claim;
- capture does **not** create an invoice or Official Order.

**Output:** a Pending Claim with provisional customer information.

### 10.9 Claim Review Customer-Resolution Workflow

This is the **primary customer-resolution point** for new claims. Authorized staff may:
- review provisional buyer information;
- search existing customer profiles;
- select a confident existing match;
- create a new staff-managed profile when no confident match exists;
- show or preserve a possible-duplicate warning when uncertain;
- associate the Pending Claim with the selected customer;
- correct the association before confirmation.

**Rules:**
- customer association must be resolved before claim confirmation where required;
- **Customer Support permission alone does not change a claim's associated customer;**
- applicable **Claim Review** authority owns this action.

### 10.10 New Customer Workflow

```
provisional identity
→ staff search
→ no confident match
→ create new staff-managed customer profile
→ associate the Pending Claim
→ continue Claim Review
```

**Rules:** no customer login; no automatic profile creation; provisional identity may seed profile fields but must remain reviewable; a possible-duplicate warning may remain visible.

### 10.11 Returning Customer Workflow

```
provisional identity
→ staff search
→ confident existing match
→ associate claim or record with existing customer
```

**Uncertain match:** do not auto-merge; show possible-duplicate warning; preserve staff review.

### 10.12 Pending Claim Association

The Pending Claim may contain: provisional Facebook name; entered customer name; captured comment/reference; screenshot evidence; captured date/time.

**Rules:**
- association is reviewable and correctable;
- the profile and claim remain **distinct records**;
- changing customer association belongs to **Claim Review**;
- notes or profile edits do not silently change claim association.

### 10.13 Confirmed Claim Association

After authorized review:
- the Confirmed Claim remains associated with the selected customer;
- the claim/reference number remains attached;
- **Confirm Claim & Print Label creates no invoice or Official Order;**
- corrections before invoicing require the applicable **Claim Review** authority.

**Customer Support alone cannot change the associated customer of a Confirmed Claim.**

### 10.14 Invoice Preparation Customer Workflow

Invoice Preparation **consumes** customer associations already established on Confirmed Claims.

**Rules:**
- group only claims belonging to the **same customer**;
- grouped claims must also share the **same payment arrangement**;
- grouped claims must share the **same fulfillment arrangement**;
- different arrangements require **separate invoice drafts and Official Orders**;
- Invoice Preparation **does not silently create or switch customer identity**;
- inconsistent association may cause the claim to be **removed from the unsent draft and returned to the pre-invoice correction path**.

### 10.15 Unsent Invoice Draft Correction

Authorized Invoice Preparation staff may:
- remove an incorrectly associated claim from the draft;
- return it to the appropriate correction path;
- regroup only after the customer association is corrected.

- **Do not silently switch the claim or draft to another customer during Approve & Send Invoice.**
- **One claim cannot appear in both For Invoice and an active draft at the same time.**

### 10.16 Official Order Customer Association

Successful **Approve & Send Invoice** creates:
- one Official System Order
- one official order number
- one invoice number
- a shared three-day hold
- retained claim/reference numbers

**Rules:**
- the Official Order appears in the customer profile;
- included claims are **not** counted again as extra orders;
- the original customer association **must not be silently reassigned** after the Official Order exists.

### 10.17 Customer Correction After Official Order Creation

- This is **not** an ordinary Customer Support edit.
- The original Official Order, financial history, payment history, layaway history, and fulfillment history **must not be silently reassigned**.
- **Do not assume automatic cancellation.**
- Exact authority, workflow, audit requirements, correction method, and possible Owner approval **remain To be confirmed**.
- **Section 22 owns resulting status behavior; Section 31 owns detailed audit requirements.**

**Do not classify every customer-detail correction as high-risk.** Only approved high-risk actions remain: **official-order cancellation, forfeiture, price override, exceptional release.**

### 10.18 Payment History in the Customer Profile

May show: Awaiting Required Payment / Deposit; Payment Submitted / Unverified; Required Payment / Deposit Verified; payment amounts; payment dates; payment history; verification attribution where later defined.

**Rules:**
- **Payment Verification permission is required to verify payments;**
- viewing payment history does **not** grant verification authority;
- **Required Payment / Deposit Verified does not automatically mean Paid in Full;**
- **Paid in Full remains To be confirmed.**

### 10.19 Layaway History in the Customer Profile

May show: Active Layaway; payment/installment activity; overdue; grace period; forfeiture-eligible; financer; migrated marker; historical values and dates.

**Rules:**
- **Layaway Monitoring and Payment Verification remain separate;**
- installment recording does **not** equal payment verification;
- forfeiture approval remains with the **Owner**;
- **forfeited-item disposition remains To be confirmed.**

### 10.20 Fulfillment History in the Customer Profile

May show: For Preparation; For Shipping; For Pickup; Approved for Release; Dispatched; Picked Up / Completed where relevant; shipping/pickup details; courier/tracking/reference; receiver details where applicable.

**Rules:**
- normal release is permission-based;
- exceptional release routes to **Owner Approvals**;
- Customer Support visibility does **not** grant fulfillment authority.

### 10.21 Existing and Migrated Customer Workflow

Authorized migration users may: search/select an existing profile; create a new profile when no confident match exists; flag a possible duplicate; associate the historical record.

Historical record types may include: historical Official Order; existing layaway; completed record; cancelled record; forfeited record; other verified historical state.

**Rules:**
- preserve actual historical values and dates;
- source marker required;
- item photo optional if unavailable;
- **do not apply current deposit rules retroactively;**
- **no automatic merge;**
- migrated operational records enter applicable workflows based on actual status.

### 10.22 Possible-Duplicate Warning Workflow

Possible outcomes: confident existing match; no match, create new profile; uncertain match, show possible-duplicate warning.

**Rules:**
- **no automatic merge;**
- Customer Support **may see** the warning;
- **Customer Support alone cannot confirm, merge, or resolve a duplicate;**
- the warning does not block ordinary viewing unless later defined.

### 10.23 Dedicated Duplicate-Review Handoff

The dedicated duplicate-review workflow belongs to **Existing Record Migration**.

**Access:** Owner; users with Existing Record Entry / Migration.

**Customer Management:** displays the profile and warning; does **not** own duplicate resolution.

- **Exact duplicate-merge mechanics remain To be confirmed.**
- **Existing Record Entry / Migration remains a recorded Section 5 reconciliation, not silently treated as already added.**

### 10.24 Customer Notes

**Version 1 rules:**
- authorized users may add customer or transaction-relevant notes when they have access to the related customer or record;
- notes are **staff-attributed**;
- note visibility follows record access;
- notes may relate to assigned operational work;
- **Customer Support is not the only permission that may add notes.**

**Notes must not change:** transaction status; payment verification; balances; customer association; item allocation; fulfillment state; permissions.

- **Note edit/delete rules remain To be confirmed.**
- **Detailed attribution, history, and audit behavior belong to Section 31.**

### 10.25 Basic Customer Profile Corrections

Customer Management may maintain approved non-transactional profile information where authorized. Examples may include: spelling correction of customer name; Facebook name; approved contact details; approved shipping or pickup details.

**Rules:**
- **exact editable fields remain To be confirmed;**
- ordinary profile corrections are **not** automatically high-risk;
- profile correction **must not silently reassign** transaction records.

### 10.26 Customer Correction Ownership Matrix

| # | Correction | Owner / access | Rule |
|---|---|---|---|
| A | Basic non-transactional profile details | **Customer Management** — Customer Support or appropriate operational access | Exact editable fields **To be confirmed** |
| B | Pending or Confirmed Claim association | **Claim Review** | **Customer Support alone cannot change it** |
| C | Unsent Invoice Draft association | **Invoice Preparation** | Remove and return to correction path; **no silent switch** |
| D | Migrated-record association | **Existing Record Migration** | **Customer Support alone cannot change it** |
| E | Association after Official Order exists | **To be confirmed** | **No silent reassignment; no assumed automatic cancellation** |
| F | Ordinary profile corrections | **Customer Management** | **Not automatically high-risk** |

### 10.27 Customer Profile / History Contents

Consider showing:
- complete customer name
- Facebook name
- approved contact information
- approved shipping/pickup information
- source markers
- total claims
- Official Orders
- Active Layaways
- Completed Orders
- Cancelled Orders
- Expired Orders
- payment history
- layaway history
- fulfillment history
- migrated history
- customer notes
- possible-duplicate warning
- **Outstanding Balance only after formally defined**

### 10.28 Counting and Summary Rules

- **Claims are not Official Orders.**
- **Migrated claim-less records do not count as claims.**
- **Migrated historical orders count as Official Orders.**
- **An Active Layaway may already be an Official Order and is not additive.**
- **Completed, Cancelled, and Expired counts refer to Official Orders, not claims.**
- **Included claims are not counted as extra orders.**
- **Outstanding Balance remains To be confirmed.**

### 10.29 Customer Visibility and Action Authority

**Owner:** full visibility and implicit access to all approved permissions.

**Selected Admin and Staff:** visibility based on role, permissions, and operational relevance.

**Customer Support may:** view and maintain approved profile information; view combined history; add allowed notes; see possible-duplicate warnings.

**Customer Support alone may NOT:** verify payment; confirm or correct claim association; prepare or send invoice; approve fulfillment release; migrate records; resolve duplicates; approve high-risk actions.

**Visibility does not equal action authority.**

### 10.30 Customer Workflow Entry and Exit Points

**Entry points:** Claim Capture; Claim Review; Existing Record Migration; Search from an existing claim, invoice, or order; Customer list/profile.

**Operational path:**
```
Claim Capture
→ Claim Review
→ Customer association
→ Confirmed Claim
→ Invoice Preparation
→ Official Order
→ Payment / Layaway / Fulfillment
→ Combined Customer History
```

**Migration path:**
```
Existing Record Migration
→ search/select/create/flag duplicate
→ associate historical record
→ operational module by actual status
→ Combined Customer History
```

**Exit states:** completed; cancelled; expired; historical/migrated; forfeiture-related history where applicable. All remain visible in combined history according to access.

### 10.31 Edge Cases

- two different buyers with the same or similar Facebook name;
- same buyer with a migrated profile and a new MineFlow profile;
- buyer with claims but no Official Order;
- migrated historical order with no claim;
- wrong customer on a Pending Claim;
- wrong customer on a Confirmed Claim;
- wrong customer inside an unsent Invoice Draft;
- wrong customer after Official Order creation;
- buyer with multiple arrangements requiring separate orders;
- customer existing only through a migrated record;
- possible duplicate that remains unresolved.

**The post-Official-Order correction and merge mechanics are not silently resolved.**

### 10.32 Customer Workflow Boundaries

- **Customer Management** owns identity and combined history.
- **Claim Review** owns claim association correction.
- **Invoice Preparation** owns buyer-level grouping.
- **Official Order Management** owns the Official Order record.
- **Payment Management** owns payment verification.
- **Layaway Management** owns installment monitoring.
- **Fulfillment Management** owns shipping/pickup work.
- **Existing Record Migration** owns historical entry and dedicated duplicate review.
- **Search** owns detailed lookup behavior.
- **Audit** owns detailed attribution requirements.
- **Notes do not change transaction records.**
- **Customer Profile is a combined view, not the owner of every underlying transaction.**

### 10.33 Section Boundaries

- **Section 10** owns the customer business workflow.
- **Section 22** owns status transitions.
- **Section 23** owns detailed search behavior.
- **Section 25** owns formal reporting definitions.
- **Section 31** owns detailed audit requirements.
- **Customer-field technical storage belongs to later technical sections.**

### 10.34 Open / To-Be-Confirmed Customer Items

- authoritative required/optional customer field list
- exact editable customer-profile fields
- searchable contact fields
- post-Official-Order customer-correction workflow
- Outstanding Balance definition
- Paid in Full definition/state
- duplicate-merge mechanics
- customer-note edit/delete behavior
- detailed audit requirements
- execution of the Section 4–5 reconciliation

### 10.35 Section 10 Summary

- **Customers are staff-managed and have no login.**
- **Capture collects provisional identity only.**
- **Claim Review or Migration resolves association.**
- **Invoice Preparation groups already-associated claims.**
- **Combined history includes new and migrated records.**
- **Visibility does not grant unrelated operational authority.**
- **No automatic matching, profile creation, merge, reassignment, or transaction change is introduced.**

---

*End of Section 10 — Customer Workflow. **APPROVED.** Section 11 — Staff Workflow follows.*

---

## Section 11 — Staff Workflow

### 11.1 Purpose of the Staff Workflow Section

This section defines how **Owner, Selected Admin, and Staff perform daily work** in Version 1 (MineFlow), based on:

- role
- granular permissions
- applicable shop/page access
- assigned or accessible work queues
- operational duties
- escalation
- high-risk approval boundaries
- shift handoffs
- incomplete work
- staff attribution
- correction paths

**Governing facts:**
- **Role title does not automatically create authority.**
- **Permission determines what a user may perform.**
- **Assignment determines responsibility or visibility, not permission.**
- **Visibility does not equal action authority.**

This section stays business-focused and staff-facing. It does not define technical authentication, database schema, APIs, code, or HR / payroll / attendance / commission / employee-performance systems.

### 11.2 Governing Staff Rules

1. Owner is the highest authority.
2. Selected Admin and Staff receive only assigned permissions.
3. Role title alone does not grant operational authority.
4. Assignment determines responsibility or visibility.
5. Permission determines whether the user may perform an action.
6. Shop/page access restricts work where applicable.
7. Queue ownership does not override missing permission or shop/page restrictions.
8. Viewing a record does not grant authority to change it.
9. Confirm Claim & Print Label creates a Confirmed Claim and label job only.
10. Approve & Send Invoice creates one Official System Order, one order number, one invoice number, and the shared three-day hold.
11. Normal fulfillment is permission-based.
12. Owner approval is required for the four approved high-risk categories.
13. No automatic claim transfer, waitlist allocation, returned-to-stock action, duplicate merge, payment verification, invoice creation, or fulfillment release occurs merely because a user opens a record.
14. Notes do not change statuses, balances, customer association, allocation, fulfillment state, or permissions.
15. New and migrated records may both enter the staff workflow according to actual status.
16. Existing Record Entry / Migration remains a recorded Section 5 reconciliation.

### 11.3 Staff Lifecycle

```
Authorized staff access
→ system determines role + permissions + applicable shop/page
→ user sees only permitted information and actions
→ review relevant work queues
→ perform authorized work
→ Live Selling
→ Claim Review
→ For Invoice
→ Invoice Draft
→ Approve & Send Invoice
→ Official Order
→ Payment / Layaway / Fulfillment
→ high-risk escalation where applicable
→ Migration / duplicate / returned-to-stock / waitlist work where permitted
→ shift handoff
→ end-of-shift review
```

- The **assigned-work view is a concept, not an approved final feature name.**
- Relevant work may appear through the Dashboard, module queues, or a future approved assigned-work feature.
- **Exact name, placement, and interaction remain To be confirmed.**

### 11.4 Authorized Staff Access and Start of Work

- The user enters through **authorized staff access**.
- The system determines role, assigned permissions, and applicable shop/page access.
- The user sees only permitted information and actions.
- **Technical authentication, password rules, sessions, device controls, and account recovery belong to Section 30.**

### 11.5 Dashboard Entry Workflow

- The Dashboard provides a **summarized operational overview within the user's access**.
- Not every staff member sees all business totals.
- Dashboard cards may reflect relevant queues, alerts, and incomplete work.
- **A dashboard card is not itself a transaction status.**
- Counts follow approved counting rules.
- Clicking or filtering behavior is defined later in Sections 7, 20, 21, 22, and 23.

### 11.6 Relevant Work Queues and Assigned-Work Concept

- The system must surface work assigned to or accessible by the user.
- **Final feature name and placement remain To be confirmed.**
- Module queues remain the primary operational record lists.
- Records may be individually assigned, shared in a queue, or both — **exact model To be confirmed**.

> **Governing rule:** Assignment determines responsibility or visibility for work. Permission determines whether the user may perform an action.

- Assignment does not grant missing permission.
- Removing assignment does not remove historical attribution.
- Queue ownership does not override shop/page restrictions.
- An assigned user may need to escalate when lacking authority.

### 11.7 Owner Workflow

The Owner:
- has global visibility;
- has all approved permissions;
- may inspect, perform, or intervene in ordinary workflows;
- owns the Owner Approval Center;
- approves or rejects formally defined high-risk requests.

**Clarifications:**
- **Global visibility does not mean every record is operationally assigned to the Owner.**
- Ordinary incomplete work remains in its operational queue unless reassigned or directly handled.
- **Exact Owner self-request or direct high-risk action behavior remains To be confirmed.**

### 11.8 Selected Admin Workflow

The Selected Admin:
- receives only assigned permissions;
- may oversee queues within assigned access;
- cannot bypass missing permissions based on title;
- cannot approve Owner-only actions;
- does not automatically gain reassignment authority.

- **Whether Selected Admin may reassign work when separately permitted remains To be confirmed.**

### 11.9 Staff Workflow

Staff:
- perform assigned or accessible operational work;
- see only permitted records and actions;
- may escalate blocked or high-risk cases;
- cannot approve Owner-only actions;
- cannot use assignment as a substitute for permission.

### 11.10 Customer Support Workflow Boundary

**Customer Support may:**
- search and view permitted customer records;
- maintain approved basic profile details;
- view permitted combined history;
- add allowed notes;
- see possible-duplicate warnings.

**Customer Support alone may NOT:**
- change customer association on a claim;
- prepare or send invoice;
- verify payment;
- monitor layaway unless separately permitted;
- release fulfillment;
- migrate records;
- resolve duplicates;
- cancel Official Orders;
- approve forfeiture;
- override price;
- approve exceptional release.

### 11.11 Live Selling Staff Workflow

At the overview level:
- open or select the active Live Batch;
- verify applicable shop/page;
- verify the Current Flex Item;
- capture or enter provisional claim information;
- create a Pending Claim;
- move the claim to Claim Review;
- switch the Current Flex Item only before claim creation where applicable;
- prevent an existing claim from silently changing item when the Current Flex Item changes.

**Do not assume automatic Facebook comment capture.** Detailed behavior belongs to Sections 12 and 13.

### 11.12 Current Flex Item Workflow

**A. Before Pending Claim creation:** authorized live staff may select, switch, or correct the Current Flex Item.

**B. After Pending Claim creation:** changing the Current Flex Item **does not** change the item on the existing claim; the claim follows Claim Review correction.

**C. After confirmation or Official Order:** correction becomes more restricted and follows the owning module.

### 11.13 Capture Claim Workflow

- capture or manual entry collects provisional buyer and claim details;
- creates a Pending Claim only;
- does **not** confirm;
- does **not** print automatically;
- does **not** create an invoice;
- does **not** create an Official Order;
- does **not** auto-match the buyer;
- does **not** auto-allocate item stock.

### 11.14 Pending Claim Review Workflow

Authorized Claim Review staff may:
- review evidence;
- resolve customer association;
- verify item;
- review miner position;
- verify quantity availability;
- correct allowed fields;
- preserve excess/waitlist claims;
- determine whether the claim is ready for confirmation.

- **Customer Support alone cannot perform these actions.**
- Detailed claim rules belong to later workflow sections.

### 11.15 Confirm Claim & Print Label Workflow

- requires applicable Claim Review authority **plus** Confirm Claim & Print Label permission;
- creates a Confirmed Claim;
- creates or queues a label job;
- routes the claim to For Invoice;
- creates **no** invoice;
- creates **no** Official Order.

### 11.16 For Invoice Staff Workflow

Authorized users may:
- review complete Confirmed Claims;
- verify customer association;
- verify payment arrangement;
- verify fulfillment arrangement;
- identify claims ready for draft grouping.

- Claims remain separate until grouped into an Invoice Draft.
- **For Invoice is not itself an Official Order.**

### 11.17 Invoice Draft Preparation Workflow

Authorized Invoice Preparation staff may:
- select complete Confirmed Claims;
- group only **same customer + same payment arrangement + same fulfillment arrangement**;
- prepare an Invoice Draft;
- remove inconsistent claims;
- return incorrect claims to the applicable correction path;
- preserve claim/reference numbers.

- Assignment to the draft does not grant missing permissions.
- **One claim cannot be in two active drafts.**

### 11.18 Approve & Send Invoice Workflow

- requires Invoice Preparation authority;
- successful action creates:
  - one Official System Order
  - one official order number
  - one invoice number
  - one shared three-day hold
- included claims remain linked;
- **no duplicate Official Order should be created by repeated action;**
- detailed button and status behavior belongs to Sections 21 and 22.

### 11.19 Official Order Monitoring Workflow

Authorized users may view and monitor Official Orders according to access. Possible work includes: payment status; reminders; layaway; fulfillment; approval needs; blocked conditions; deadlines.

- **Viewing does not grant payment, layaway, fulfillment, cancellation, or approval authority.**

### 11.20 Reminder Workflow

Authorized users may:
- review reminders due;
- perform allowed follow-up;
- record permitted reminder-related activity;
- escalate missing information or blocked orders.

- **Reminder work does not equal payment verification.**
- Detailed reminder delivery belongs to Section 26.

### 11.21 Payment Submitted / Unverified Workflow

Authorized users may:
- view submitted payment evidence;
- record or attach permitted evidence;
- identify the related Official Order;
- route the record for verification.

Keep separate: **payment evidence recorded by** vs. **payment verified by**.

- **Recording evidence does not verify the payment.**

### 11.22 Payment Verification Workflow

Requires **Payment Verification** permission. Authorized verifier may:
- review evidence;
- confirm required payment/deposit;
- record verification result;
- update the applicable payment state where later defined.

**Rules:**
- Layaway Monitoring alone cannot verify payment;
- Customer Support cannot verify payment;
- Required Payment / Deposit Verified does **not** automatically mean Paid in Full;
- detailed behavior belongs to Sections 16 and 22.

### 11.23 Payment Attached to Wrong Order

- Payment records **must not be silently moved** between Official Orders.
- Customer Support cannot perform this correction.
- Layaway Monitoring alone cannot perform it.
- **Payment Verification or a later approved payment-correction authority** initiates a controlled correction path.
- Original evidence, verification state, performer, date, and affected orders remain traceable.
- **Whether Owner approval is required remains To be confirmed.**
- **No reversal, refund, void, transfer, or accounting method is defined here.**

### 11.24 Layaway Monitoring Workflow

Requires **Layaway Monitoring** permission. Authorized users may:
- review Active Layaway;
- record installment-related activity where allowed;
- review due dates;
- identify overdue;
- identify grace period;
- identify forfeiture eligibility;
- record financer where applicable.

**Rules:**
- monitoring does **not** equal payment verification;
- forfeiture requires Owner approval;
- detailed rules belong to Section 17.

### 11.25 Shipping Preparation Workflow

Authorized fulfillment users may:
- review fulfillment details;
- prepare items;
- confirm applicable payment/deposit requirement;
- enter or verify shipping details;
- prepare dispatch information.

- **Preparation does not automatically mean release.**
- Detailed workflow belongs to Section 18.

### 11.26 Pickup Preparation Workflow

Authorized fulfillment users may:
- prepare the pickup item;
- verify permitted pickup details;
- review payment/deposit requirement;
- prepare receiver or handover information.

- **Preparation does not automatically mean completion or release.**

### 11.27 Normal Release Workflow

- Normal release is **permission-based**.
- It is **not** automatically Owner-only.
- Required conditions must be satisfied.
- Authorized fulfillment staff may complete the allowed release step.
- Exact release states and transition rules belong to Sections 18 and 22.

### 11.28 Exceptional Release Request Workflow

High-risk category.
```
authorized requester
→ creates exceptional release request
→ reason + supporting information
→ Needs Owner Approval
→ Owner approves or rejects
→ fulfillment workflow resumes only after decision
```
- Non-Owner users cannot approve.
- **Owner direct-action or self-request behavior remains To be confirmed.**

### 11.29 Official-Order Cancellation Request Workflow

High-risk category.
```
authorized requester
→ reason + supporting information
→ Needs Owner Approval
→ Owner approves or rejects
→ resulting status follows Section 22
```
- Cancellation is **not** performed by Customer Support.
- No automatic inventory return or claim transfer occurs.

### 11.30 Forfeiture Approval Workflow

High-risk category.
```
layaway becomes forfeiture-eligible
→ authorized requester submits reason and supporting details
→ Owner approves or rejects
→ resulting handling follows Sections 17, 19, and 22
```
- **Eligibility is not approval.**
- **Forfeited-item disposition remains To be confirmed.**

### 11.31 Price Override Request Workflow

High-risk category.
```
authorized requester
→ requested price change + reason + supporting information
→ Needs Owner Approval
→ Owner approves or rejects
→ applicable workflow continues only after decision
```
- **Do not define accounting or discount logic here.**

### 11.32 Owner Approval Center Workflow

The Owner Approval Center shows formally defined high-risk requests only:
- official-order cancellation
- forfeiture approval
- price override
- exceptional release

The Owner may: review reason; review supporting information; approve; reject; inspect the related record.

- Ordinary queue work does not automatically move to the Owner Approval Center.
- Selected Admin and Staff cannot approve these requests.
- **Owner self-request / direct-action / delegation remains To be confirmed.**

### 11.33 Returned-to-Stock Review Workflow

Authorized inventory users may:
- review withdrawn, approved-cancelled, or expired unpaid items;
- verify current record state;
- decide the next permitted inventory action where later defined.

**Rules:** no automatic stock return; no automatic transfer; no automatic waitlist allocation; detailed rules belong to Section 19.

### 11.34 Waitlist Review Workflow

Authorized staff may:
- review excess or waitlisted claims;
- review available quantity;
- inspect claim order and evidence;
- take only later-approved actions.

**Rules:** no automatic reallocation; no automatic transfer to another miner; detailed rules belong to Section 19 and Section 22.

### 11.35 Existing Record Migration Staff Workflow

Authorized migration users may:
- search/select customer;
- create profile if necessary;
- flag possible duplicate;
- enter historical record;
- preserve historical dates and values;
- apply source marker;
- select verified actual status;
- hand off to the owning module.

**Rules:**
- migration permission does **not** grant payment, layaway, fulfillment, cancellation, or other operational authority;
- editing historical facts is controlled;
- **exact migrated-record correction behavior remains To be confirmed.**

### 11.36 Possible-Duplicate Review Workflow

Existing Record Migration owns the dedicated duplicate-review workflow. Authorized users may:
- inspect the possible match;
- review identity/history;
- preserve the warning;
- follow later-approved resolution rules.

**Rules:** no automatic merge; Customer Support alone cannot resolve; **exact merge mechanics remain To be confirmed**.

### 11.37 Print Queue and Reprint Workflow

Authorized users may:
- view pending, successful, and failed print jobs;
- retry or reprint only when permitted;
- inspect the related claim/order context.

**Rules:** accidental duplicate print follows Print Queue correction; opening a failed job does not automatically print; detailed rules belong to Sections 24 and 27.

### 11.38 Staff Notes Workflow

Authorized users may add notes relevant to their assigned operational work where they can access the related record.

**Rules:**
- notes are staff-attributed;
- visibility follows record access;
- notes do **not** change status, balance, customer association, allocation, fulfillment state, or permissions;
- **note edit/delete remains To be confirmed;**
- detailed history belongs to Section 31.

### 11.39 Search and Navigation Workflow

Authorized users may search or navigate using approved identifiers within their permission and shop/page access.

- **Search visibility does not grant action authority.**
- Detailed searchable fields and behavior belong to Section 23.
- Dashboard cards and queues may navigate to filtered records where later defined.

### 11.40 Shift Handoff Workflow

Handoff may include:
- current status
- last completed action
- next required action
- relevant notes
- blocked reason
- pending approval
- date/deadline
- responsible user where formally assigned
- relevant queue when no individual assignment exists

**Rules:** not every record requires an individual assignee; unfinished work remains visible; **handoff acknowledgement behavior remains To be confirmed**.

### 11.41 Queue Reassignment and Staff Absence

- Unfinished work remains visible even if the prior responsible user is absent.
- Reassignment does not erase previous attribution.
- A reassigned user still needs permission and shop/page access.
- Selected Admin reassignment power is **not assumed by title**.
- Owner may intervene.
- **Exact authority and mechanics remain To be confirmed.**

**Do not introduce attendance, leave, or scheduling features.**

### 11.42 Concurrent Staff Work

**Business requirements:**
- users should not unknowingly perform conflicting actions;
- the same critical action should not complete twice;
- a user should be warned when a record changed after it was opened;
- completed transitions should not repeat;
- the latest valid state must be respected.

- **No technical locking/versioning implementation is defined.**
- Later ownership may involve Sections 28–32.

### 11.43 Staff Attribution Requirements

Records should be able to show who performed material actions. Possible categories:
- created by
- reviewed by
- confirmed by
- invoice prepared by
- invoice approved/sent by
- payment evidence recorded by
- payment verified by
- layaway updated by
- fulfillment prepared by
- released by
- dispatched by
- pickup completed by
- migration entered by
- approval requested by
- approval decided by
- note added by

**Rules:**
- attribution belongs to the action, not role title;
- reassignment does not replace attribution;
- attribution does not automatically mean approval;
- requester, performer, verifier, preparer, and approver may differ;
- attribution does **not** define payroll, commission, HR, disciplinary, or legal liability;
- detailed display/history belongs to Section 31.

### 11.44 Staff Mistake and Correction Paths

- wrong Current Flex Item
- wrong customer association
- wrong item association
- wrong miner position
- incorrect quantity
- wrong invoice grouping
- payment on wrong order
- wrong fulfillment details
- wrong migrated status
- accidental duplicate print
- unsupported high-risk attempt

**Rules:** no unrestricted rollback; correction follows the owning module; later-stage records are progressively more restricted.

### 11.45 Unauthorized Action Behavior

Unauthorized actions may be:
- hidden;
- disabled with explanation;
- blocked when attempted another way;
- routed to escalation/request where applicable.

**Rules:** unauthorized attempts do not change the record; visibility does not grant authority; detailed security behavior belongs to Section 30; detailed error messaging belongs to Section 32.

### 11.46 Escalation Rules

Escalation applies when:
- a user lacks required permission;
- a record is blocked;
- an action requires Owner approval;
- a correction is outside ordinary authority;
- required information is missing;
- a conflict or stale-record warning occurs.

- **Escalation does not itself approve or perform the action.**
- The record remains in its valid state until authorized action occurs.

### 11.47 Daily Opening Workflow

Show only relevant authorized work:
- applicable shop/page context
- permitted dashboard cards
- relevant queues
- alerts
- incomplete work
- pending approvals visible to the user
- blocked records within access

**Do not assume access to all business totals.**

### 11.48 During-Live Workflow

High-level sequence:
- verify the active Live Batch
- verify the Current Flex Item
- enter/capture provisional claim
- create Pending Claim
- review claim
- resolve customer
- confirm claim
- print label job
- move to For Invoice

**No automatic Facebook reading.**

### 11.49 After-Live Workflow

High-level sequence:
- review unresolved Pending Claims
- complete Claim Review
- group ready Confirmed Claims
- prepare Invoice Drafts
- Approve & Send Invoice
- create Official Orders
- process reminders
- review unverified payments
- monitor layaway
- prepare fulfillment

### 11.50 End-of-Shift Workflow

Review only relevant authorized unfinished work:
- unresolved Pending Claims
- incomplete Invoice Drafts
- reminders due
- unverified payments
- layaway follow-ups
- fulfillment in progress
- failed print jobs
- pending Owner approvals
- incomplete migration
- blocked/error records

- **Unfinished work is preserved for the next authorized user or work period.**

### 11.51 Entry and Exit Points Across Modules

**Entry points:** authorized staff access; Dashboard; module queues; Live Batch; Claim Review; Invoice Preparation; Official Order; Payment; Layaway; Fulfillment; Migration; Owner Approval Center; Search.

**Exit or carry-over:** completed; cancelled; expired; historical/migrated; pending approval; blocked; unfinished handoff.

### 11.52 Staff Workflow Boundaries

- **Section 11** owns the daily staff journey.
- **Section 12** owns the detailed Live Selling Workflow.
- **Section 13** owns capture behavior.
- **Section 15** owns the Invoice Workflow.
- **Section 16** owns the Payment Workflow.
- **Section 17** owns the Layaway Workflow.
- **Section 18** owns Shipping/Pickup.
- **Section 19** owns Inventory.
- **Section 21** owns button behavior.
- **Section 22** owns status transitions.
- **Section 23** owns search.
- **Section 24** owns print/reprint.
- **Section 26** owns notification/reminder delivery.
- **Sections 28–32** own technical integrity, API safeguards, security, audit, and recovery.

### 11.53 Edge Cases

- assigned user lacks permission;
- user can view but cannot act;
- user assigned to wrong shop/page;
- multiple staff open the same record;
- action completed by another staff first;
- Current Flex Item changes after claim creation;
- wrong customer on a claim;
- duplicate invoice action attempt;
- payment attached to the wrong order;
- fulfillment prepared but not releasable;
- high-risk request rejected;
- prior responsible user absent;
- shared queue with no individual assignee;
- migrated record enters an active operational state;
- failed print job;
- possible duplicate unresolved.

### 11.54 Open / To-Be-Confirmed Staff Items

- final assigned-work feature name and placement
- exact assignment method
- individual assignment versus shared queue rules
- exact reassignment authority
- whether Selected Admin may reassign when separately permitted
- multi-shop/page access
- handoff acknowledgement behavior
- conflict-warning and stale-record behavior details
- technical concurrency implementation
- Owner direct-action or self-approval treatment
- Owner delegation of high-risk approvals
- exact attribution display locations
- controlled payment-to-wrong-order correction workflow
- exact migrated-record correction authority
- Paid in Full and Outstanding Balance definitions
- post-Official-Order customer-correction workflow
- forfeited-item disposition
- execution of Section 4–5 reconciliation

### 11.55 Section 11 Summary

- **Staff authority comes from permissions, not title.**
- **Assignment does not create permission.**
- **Dashboard and queues show only relevant accessible work.**
- **Daily work moves through Live, Claims, Invoice, Official Order, Payment/Layaway/Fulfillment.**
- **High-risk actions require Owner approval.**
- **Shift handoff preserves unfinished work.**
- **Concurrent work must not duplicate critical actions.**
- **Attribution belongs to actions.**
- **Migration hands off ongoing work to the owning module.**
- **Nothing automatic or unrestricted is introduced.**

---

*End of Section 11 — Staff Workflow. **APPROVED.** Section 12 — Live Selling Workflow to follow.*

---

## Section 12 — Live Selling Workflow

### 12.1 Purpose of the Live Selling Workflow Section

This section defines the complete **staff-facing business workflow** for running A.V. Jewelry's live-selling operation in Version 1 (MineFlow), covering:

- preparing a Live Batch;
- preparing items;
- selecting the Current Flex Item;
- accepting during-live claims;
- accepting post-live manually entered claims;
- creating Pending Claims;
- handing claims to Claim Review;
- monitoring live work;
- ending and reviewing a Live Batch;
- closing and viewing batch history.

**Governing scope statements:**

- **Section 12 covers new staff-originated claim intake** — the two paths by which a fresh claim enters the system.
- **Historical migration remains separate** (Section 6.20, Section 10.21, Section 11.35) and is never mixed into normal live or post-live intake.
- **A Live Batch does not create an Official Order.**
- **Capture or manual entry creates a Pending Claim only.**

This section stays business-focused and staff-facing. It does not define database schema, APIs, code, technical authentication, OCR, automatic Facebook-comment reading, actual camera or file implementation, actual Pancake or Meta implementation, printer SDK behavior, exact button behavior, final status-transition logic, detailed inventory calculations, or technical retry/locking implementation. It introduces no new permissions, statuses, integrations, automatic behavior, or technical implementation beyond approved Sections 1–11, and it does not silently resolve any To-be-confirmed item.

### 12.2 Live-Selling Intake Paths

Version 1 recognizes **three distinct intake paths**. Two are new-claim intake paths owned by this section; the third is historical migration, which is kept separate.

**A. During-Live Intake**
```
Current Flex Item
→ live capture or manual live entry
→ Pending Claim
→ Claim Review
```

**B. Post-Live Manual Intake**
```
Orders workspace
→ Manual Entry
→ provisional customer and item details
→ take/upload item or evidence photo
→ Pending Claim
→ Claim Review
```

**C. Historical Migration**
- remains **separate** from normal live/post-live claim intake;
- does **not** use the during-live or post-live claim intake paths;
- **preserves historical values and the actual historical status** (Section 6.20, Section 10.21).

**Paths A and B converge** at the same approved lifecycle:
```
Claim Review
→ Confirm Claim & Print Label
→ For Invoice
→ Invoice Draft
→ Approve & Send Invoice
→ Official Order
```

Migration (Path C) must **never** be entered through the live or post-live intake paths, and neither new-claim path may be treated as migration.

### 12.3 Governing Live-Selling Rules

1. A **Live Batch** is the operational container for one selling session or approved live-selling work period.
2. A Live Batch is **not** the Facebook Live broadcast itself.
3. **Ending the broadcast does not automatically close the Live Batch.**
4. A Live Batch **does not create an invoice or Official Order.**
5. Items **must be prepared** before becoming available for live use.
6. New Live Batch items require: **item code, grams per piece, quantity, item photo, and total price per piece.**
7. **Total price per piece is not price per gram.**
8. Capture requires a **Current Flex Item only for the during-live Current-Flex flow.**
9. **Post-live Manual Entry does not require an active Current Flex Item.**
10. **Capture/manual entry creates a Pending Claim only.**
11. **No automatic** buyer matching, customer creation, stock allocation, miner detection, confirmation, printing, invoicing, or Official Order creation occurs.
12. **Claim Review resolves** customer, item, miner position, quantity, and correction readiness.
13. **Confirm Claim & Print Label** creates a Confirmed Claim and label job, then routes to For Invoice.
14. **Confirm Claim & Print Label creates no invoice or Official Order.**
15. **Approve & Send Invoice is the Official Order creation point.**
16. **No automatic** transfer, waitlist allocation, duplicate merge, stock return, message delivery, or payment verification occurs.
17. **Assignment does not create permission.**
18. **Visibility does not equal action authority.**
19. **Notes do not change records or statuses.**
20. **Migration must not be mixed** into normal live/post-live intake.

### 12.4 Live Batch Definition

A **Live Batch** is:

- the **operational container** for one selling session or selling period;
- the place where **items, the Current Flex Item, new claims, live notes, counts, staff actions, and unresolved work** are organized;
- **separate from the public Facebook broadcast** — the broadcast may start, stop, drop, or re-live independently of the batch record.

Exact technical structure of the Live Batch belongs to later sections.

### 12.5 Proposed Live Batch Lifecycle

The following are presented **only as business stages or status candidates**, not as final system statuses:

```
Draft Live Batch
→ Items Prepared
→ Ready for Live
→ Active Live
→ Live Ended / Under Review
→ Claim Cleanup and Handoff
→ Completed / Closed
→ Historical View
```

**Clarifications:**
- **Final names and transitions belong to Section 22.**
- **Items Prepared, Ready for Live, and Claim Cleanup and Handoff** may be display or business phases rather than final statuses.
- **Historical View is a view, not a status.**
- **Live Ended and Closed may be separate concepts.**
- The final distinction **remains To be confirmed.**

### 12.6 Live Batch Creation Workflow

```
authorized user
→ create/open Live Batch
→ enter approved batch information
→ prepare items
→ verify items
→ mark items available
→ select Current Flex Item when ready
→ begin live operations when authorized
```

**Possible batch information:**
- batch reference or name
- date
- planned start time
- actual start time
- shop/page
- responsible or participating staff
- notes
- item count
- batch state

**Rules:**
- **Exact required and optional fields remain To be confirmed.**
- Item count and some batch values **may be derived** rather than entered.
- The **exact reference format remains To be confirmed.**

### 12.7 Shop/Page Context

- Version 1 supports **one business and one primary Facebook Page.**
- **Shop/page context must still be preserved** where applicable, so the model does not have to be rebuilt for future expansion.
- **Non-Owner users remain restricted** by their applicable access.
- The **Owner has global visibility.**
- **Global visibility does not mean operational assignment** (Section 11.7).

### 12.8 Live Batch Permissions

The following are **business authorities**, described without inventing permission names:

- create Live Batch
- edit batch information
- add/edit items
- select/switch/clear Current Flex Item
- start live operations
- capture/manual-enter claims
- end live operations
- close Live Batch
- reopen batch
- withdraw item
- add notes
- view history

**Findings:**
- **Live Batch Item Entry** and **Claim Capture** (Section 5.6) cover some of these actions.
- **Create/start/end/close/reopen, Current Flex Item authority, and item-withdrawal authority** are **not** explicitly covered by the approved Section 5 permission list and **require Section 4–5 reconciliation.**
- **None of these become Owner-only unless later approved.**
- **No new permission is silently introduced.**

### 12.9 Item Preparation Workflow

```
open Live Batch
→ add/select item
→ enter required information
→ add required item photo
→ verify details
→ mark available for live use
→ select as Current Flex Item when ready
```

### 12.10 Required New Live Item Fields

A new Live Batch item requires:

- **item code**
- **grams per piece**
- **quantity**
- **required item photo**
- **total price per piece**

**Rules (Section 4.4):**
- **Price means the total selling price for one piece.**
- **Grams per piece is recorded separately.**
- **Quantity means the number of truly identical pieces** (same item type, grams, price, and photo/reference).
- **Different pieces require separate item codes.**
- **Do not calculate or display price per gram unless later approved.**

### 12.11 Item Photo Requirement

- **New Live Batch items require an item photo** (Section 4.4.7).
- **One photo may represent identical grouped pieces** where approved.
- **Migrated records may have missing historical photos**, but **migration is outside this workflow** (Section 6.20).
- **Exact replacement and retention rules belong to later sections.**

### 12.12 Item Editing Before Claims

- Authorized users may **correct item details before the item has any claims**, subject to permission.
- The **exact edit cutoff remains To be confirmed.**
- **Changing item details must not silently alter unrelated historical records.**

### 12.13 Item Editing After Claims Exist

- **Item edits become progressively restricted** after Pending Claims, Confirmed Claims, Invoice Drafts, or Official Orders exist.
- **Changing the Current Flex Item does not change the stored item on an existing claim** (Section 11.12).
- **Correction follows the owning module.**
- **Exact rules belong to Sections 19, 21, and 22.**

### 12.14 Item Withdrawal

- An authorized user may **request or perform a later-approved item withdrawal action.**
- **Withdrawal authority remains To be confirmed.**
- **Withdrawal does not automatically transfer claims.**
- **Withdrawal does not automatically return stock.**
- **Related claims and evidence remain visible.**
- **Detailed inventory handling belongs to Section 19.**

### 12.15 Current Flex Item Definition

The **Current Flex Item** is:

- the **single item currently being presented** during the active Live Batch;
- the **proposed item association** used for future during-live claim capture.

**Rules:**
- **One Current Flex Item per active batch at a time is a Section 12 proposal**, strongly supported by the singular workflow language of the approved sections (Section 8.4.D, Section 9.5).
- **Final confirmation of the one-at-a-time rule remains To be confirmed.**

### 12.16 Current Flex Item Information

Staff should be able to see:

- item photo
- item code
- grams per piece
- total price per piece
- quantity
- **remaining quantity where later validated**

**Rules:**
- **Remaining quantity depends on the final inventory-impact point.**
- The **exact inventory impact remains To be confirmed** (Sections 19 and 22).

### 12.17 Selecting and Switching Current Flex Item

- Staff **must verify the item before capture.**
- **Switching affects future claim entry only.**
- **Existing Pending Claims, Confirmed Claims, Invoice Drafts, and Official Orders keep their stored item association.**
- **Switching must not silently change another user's existing record.**

### 12.18 No-Current-Flex State

- The **during-live Current-Flex capture action is unavailable or blocked** when no Current Flex Item exists.
- Staff may **select an item** or use **another authorized intake path.**
- **Post-live Manual Entry remains independent of the Current Flex Item.**
- **Exact UI treatment belongs to Sections 20 and 21.**

### 12.19 Starting Live Operations

Authorized staff:
- open the prepared batch;
- verify shop/page;
- verify available items;
- verify the Current Flex Item;
- begin new during-live claim intake.

**Exact permission and status transition remain To be confirmed.**

### 12.20 Active-Live Workflow

```
open active batch
→ verify Current Flex Item
→ buyer mines
→ staff capture or manually enter provisional details
→ create Pending Claim
→ route to Claim Review
→ switch Current Flex Item for future claims as needed
```

**Rules:**
- **No automatic Facebook reading.**
- **Participation does not grant missing permission.**

### 12.21 Pause and Resume

Pause and resume are treated as an **operational concept.**

- **Pausing suspends new normal live intake without closing the batch.**
- **Existing records remain preserved.**
- **Final status names and authority remain To be confirmed.**
- **Exact behavior belongs to Section 22.**

### 12.22 During-Live Claim Entry

Possible intake methods:
- manual live entry
- screenshot upload
- iOS screenshot and Share to MineFlow
- planned Android floating Capture Claim

**Rules:**
- **Section 13 owns method-specific details.**
- **Android remains subject to technical validation.**
- **No OCR or automatic reading.**
- **Manual entry must remain available where authorized.**

### 12.23 Provisional Claim Information

May include:
- Facebook name
- entered customer name
- mine comment/reference
- screenshot evidence
- captured date/time
- entered or suggested claim position for review
- provisional quantity
- Current Flex Item association
- staff attribution

**None of these alone confirm the claim.**

### 12.24 Claim Position for Review

- Miner position is **entered or suggested for review.**
- It is **not automatically detected.**
- **Staff reviews evidence.**
- **Final miner position belongs to Claim Review.**
- **Ties and unclear order require review.**
- **No universal tie-breaker is introduced.**

### 12.25 Pending Claim Creation

Capture or manual live entry creates:
- one **Pending Claim**
- provisional customer information
- proposed item association
- evidence
- source marker
- staff attribution

It **does not** create:
- Confirmed Claim
- physical print
- invoice
- Official Order
- stock allocation
- transfer
- customer profile match
- final miner position

### 12.26 Claim Source Marker

A **source marker is required for traceability.**

Possible candidates:
- Live Claim
- Post-Live Message
- Private Message
- Manual Staff Entry
- Walk-in

**Rules:**
- The **final list remains To be confirmed.**
- **Source does not change lifecycle rules.**
- **Source does not create an Official Order.**
- **Reporting by source belongs to Section 25.**

### 12.27 Unique-Item Workflow

For **quantity = 1** (Section 4.9-A):
- **only 1st Miner and 2nd Miner;**
- **no 3rd Miner;**
- **one available piece;**
- **2nd Miner is a backup/secondary claim for staff review;**
- **no automatic transfer;**
- **no automatic confirmation of the 2nd Miner;**
- **exact priority/hold/transfer timing remains To be confirmed;**
- **withdrawn, cancelled, expired, or unpaid handling does not auto-transfer.**

### 12.28 Multi-Stock Workflow

For **quantity greater than 1** (Section 4.9-B):
- verified claims may be fulfilled **up to available quantity;**
- **claim order and evidence are reviewed;**
- one buyer may receive **multiple units only if quantity and stock are confirmed;**
- **excess becomes waitlist/excess;**
- **no automatic reallocation;**
- **unreviewed Pending Claims do not reduce remaining quantity automatically.**

**Rules:**
- The **exact inventory-impact point remains To be confirmed.**
- **Sections 19 and 22 own the final rules.**

### 12.29 Excess and Waitlist Handling

- **Excess claims remain visible for staff review.**
- **No automatic allocation.**
- **No automatic transfer to another miner.**
- **Freed stock requires staff review.**
- **Detailed behavior belongs to Sections 19 and 22.**

### 12.30 Duplicate Claim Risks

Situations that may warrant a warning or review:
- same screenshot entered twice
- same buyer/comment entered by two staff
- same buyer claims the same unique item repeatedly
- duplicate save after network retry
- claim already confirmed elsewhere
- reused comment reference
- similar Facebook names
- two staff capture the same comment
- duplicate manual post-live Pending Claim

**Rules:**
- **Warning/review only.**
- **No automatic deletion or merge.**
- **Exact detection remains To be confirmed.**

### 12.31 Concurrent Staff Work

Business requirements:
- a **critical action must not complete twice;**
- **Current Flex switching must not corrupt another user's existing entry;**
- **ending/closing the batch must not discard another user's saved or pending work;**
- a **confirmed claim must not be confirmed again;**
- the **latest valid state must be respected;**
- users should be **warned when relevant records changed.**

**Technical concurrency belongs to Sections 28–32.**

### 12.32 Claim Review Handoff

**Both during-live and post-live Pending Claims enter the same Claim Review workflow.**

Claim Review resolves:
- customer association
- item association
- miner position
- quantity availability
- duplicate warning
- allowed corrections
- readiness for confirmation

**Customer Support alone cannot perform this** (Section 11.10).

### 12.33 Confirm Claim & Print Label Boundary

- **Separate permission required.**
- Creates a **Confirmed Claim.**
- Creates or queues a **label job.**
- **Routes to For Invoice.**
- **Creates no invoice or Official Order.**
- **A label job does not guarantee successful physical print.**

### 12.34 For Invoice Handoff

- **Complete Confirmed Claims move to For Invoice.**
- **Live and post-live claims may be grouped** when they share:
  - same customer
  - same payment arrangement
  - same fulfillment arrangement
- **Claims remain separate until grouped.**
- **For Invoice is not an Official Order.**

### 12.35 Manual Post-Live Entry Purpose

Manual Post-Live Entry is the **new-claim intake path** for a customer who:
- messages after the live;
- communicates privately;
- walks in;
- or otherwise requires authorized staff manual entry.

**Rules:**
- The **working action name remains To be confirmed.**
- **This is not migration.**
- **It creates a Pending Claim, not an Official Order.**

### 12.36 Orders Workspace Manual Entry

Client-confirmed entry point:
```
Orders workspace
→ + Manual Entry
```

**Rules:**
- This is a **navigation convenience.**
- The **created record belongs to the Claims/Claim Review pipeline.**
- **It must not appear as an Official Order.**
- **Exact placement and button behavior belong to Sections 8, 20, and 21.**

Candidate secondary entry points **remain To be confirmed:**
- Claims workspace
- For Invoice
- Customer Profile
- global quick action

### 12.37 Manual Post-Live Entry Workflow

```
Orders workspace
→ Manual Entry
→ enter provisional customer details
→ enter/select item details
→ choose source marker
→ take/upload photo or evidence
→ review entered information
→ create Pending Claim
→ Claim Review
→ Confirmed Claim
→ For Invoice
→ Invoice Draft
→ Approve & Send Invoice
→ Official Order
```

### 12.38 Manual Entry Customer Fields

Possible fields:
- Facebook name
- entered customer name
- customer search/select/create
- approved contact information
- customer message/reference

**Rules:**
- **Exact required fields remain To be confirmed.**
- **Claim Review owns final customer association.**
- **A possible-duplicate warning remains.**
- **No automatic profile match or merge.**

### 12.39 Manual Entry Item Fields

Possible fields:
- select existing item
- item code
- grams per piece
- quantity
- total price per piece
- item photo
- description where approved

**Rules:**
- **Existing item selection does not silently edit item data.**
- **New item creation from this form remains To be confirmed.**
- **Exact post-live item authority remains To be confirmed.**
- **No automatic stock allocation.**

### 12.40 Manual Entry Transaction Fields

Possible fields:
- payment arrangement
- fulfillment arrangement
- source marker
- entered/captured date and time
- staff note
- supporting evidence

**Exact required/optional rules remain To be confirmed.**

### 12.41 Take Photo and Upload Photo

Business actions:
- Take Photo
- Upload Photo
- Preview
- Replace
- Remove before save
- attach supporting evidence where permitted

**Rules:**
- **Exact device behavior belongs to later technical sections.**
- **No OCR or automatic reading.**
- **A photo does not confirm or create an order.**

### 12.42 Item Photo Versus Claim Evidence

**A. Item Photo**
- represents the jewelry item;
- **required for a new Live Batch item;**
- **post-live requirement remains To be confirmed.**

**B. Claim/Message Evidence**
- supports the customer message, item code, handwritten detail, or transaction context;
- **required versus optional depends on source.**

Carry as **To be confirmed:**
- photo count
- file size
- file type
- required evidence per source
- whether the same image can serve both purposes
- retention/replacement rules

### 12.43 Manual Entry Permission Boundary

- **Claim Capture may cover Pending Claim creation.**
- **Live Batch Item Entry may not cover post-live item creation.**
- **Claim Review remains required.**
- **Confirm Claim & Print Label remains separate.**
- **Invoice Preparation remains separate.**
- **Photo/evidence attachment and Orders manual-entry access require Section 4–5 reconciliation.**
- **No new permission is silently added.**

### 12.44 Live Batch Monitoring

Possible operational summaries:
- total batch items
- Current Flex Item
- available items
- items with claims
- Pending Claims
- Confirmed Claims
- For Invoice claims
- waitlist/excess
- claims needing review
- failed/pending label jobs
- withdrawn items
- blocked/unresolved issues

**Rules:**
- These are **operational summaries.**
- **Do not count Pending Claims as sales or Official Orders.**
- **Section 25 owns formal reporting.**

### 12.45 Batch-Level and Item-Level Counts

- **Exact count definitions remain To be confirmed.**
- **Counts must avoid double-counting.**
- **Sales metrics are outside Section 12.**
- **Item remaining quantity depends on final inventory-impact rules.**

### 12.46 Live-Work Staff Attribution

Consider attribution for:
- batch created by
- batch started by
- item added by
- item updated by
- Current Flex selected by
- claim captured/entered by
- claim reviewed by
- claim confirmed by
- label requested by
- batch ended by
- batch closed by
- note added by
- manual post-live entry created by

**Rules:**
- **Attribution belongs to the action.**
- **Reassignment does not erase it.**
- **Section 31 owns detailed audit history.**

### 12.47 Notes During Live Work

- Authorized users may **add relevant notes.**
- **Notes are staff-attributed.**
- **Notes do not change item, claim, batch, payment, fulfillment, inventory, or permission state.**

### 12.48 Error and Fallback Workflow

Business behavior is considered for:
- internet failure
- capture failure
- screenshot upload failure
- iOS Share unavailable
- Android capture unavailable
- Pancake unavailable
- printer disconnected
- label failure
- claim save failure
- duplicate save
- Current Flex changes during entry
- accidental batch end
- incomplete item
- camera unavailable
- photo upload failure

**Core rules:**
- **Manual entry remains available where authorized.**
- **No failed action creates silent duplicates.**
- **Unresolved failures remain visible.**
- **Exact technical retry/recovery belongs to Section 32.**

### 12.49 Printer-Unavailable Behavior

- **Confirm Claim & Print Label may create a pending/failed label job.**
- **Physical print success is separate.**
- **The claim remains Confirmed where applicable.**
- **A failed job stays in the Print Queue.**
- **Retry/reprint belongs to Sections 24 and 27.**

### 12.50 End-of-Live Workflow

```
end live-selling activity
→ stop new normal live claims
→ preserve Pending Claims
→ review unresolved entries
→ confirm/correct eligible claims
→ review waitlist/excess
→ review unsold/withdrawn items
→ review failed print jobs
→ hand off For Invoice claims
→ preserve blocked records
→ close batch only when appropriate
```

### 12.51 Live Ended Versus Batch Closed

- **Ending the Facebook Live does not automatically close the batch.**
- **Live Ended may mean capture stopped and review continues.**
- **Closed may mean active batch work is complete.**
- **The exact distinction and status names remain To be confirmed.**

### 12.52 Unresolved Claims After Live

Unresolved claims:
- **remain in Pending Claim or relevant queues;**
- **do not auto-confirm;**
- **do not auto-cancel;**
- **do not disappear on closure;**
- **continue through Claim Review or handoff.**

### 12.53 Unsold and Unclaimed Items

- **No automatic return to stock.**
- **No automatic transfer to shop or auction.**
- **Disposition remains To be confirmed.**
- **Section 19 owns inventory handling.**
- **The historical batch view preserves the outcome.**

### 12.54 Withdrawn Items

- **Withdrawal does not erase history.**
- **Claims remain visible.**
- **No automatic transfer or stock action.**
- **Exact authority and disposition remain To be confirmed.**

### 12.55 Items with Claims at End of Live

Covered separately:
- item with Pending Claims
- item with Confirmed Claims
- item with For Invoice claims
- item with waitlist/excess

**Batch ending does not change their record state automatically.**

### 12.56 Live Batch Completion Criteria

Possible criteria may include:
- live intake ended;
- unresolved claims identified;
- items reviewed;
- failed print jobs surfaced;
- For Invoice claims handed off;
- blocked records preserved.

**Rules:**
- **Exact closure criteria remain To be confirmed.**
- **Closing does not require every downstream order/payment/fulfillment activity to be completed.**

### 12.57 Closing a Live Batch

- An authorized user may **mark the batch closed where later approved.**
- **No automatic** confirmation, invoice, Official Order, stock return, waitlist allocation, or record deletion.
- **Exact authority remains To be confirmed.**
- **Not automatically Owner-only.**

### 12.58 Reopening a Closed Batch

- **Whether reopening is allowed remains To be confirmed.**
- **Reopening authority remains To be confirmed.**
- **Corrections must not rewrite historical actions silently.**
- **Final status behavior belongs to Section 22.**

### 12.59 Historical Batch View

May show:
- batch information
- items
- Current Flex history where available
- claims
- claim outcomes
- waitlist/excess
- notes
- unresolved or transferred work
- staff attribution
- ended/closed information

**Rules:**
- **Historical View is not a status.**
- **Exact editability remains controlled.**

### 12.60 Shift Handoff for Active or Incomplete Batch

May include:
- current batch state
- Current Flex Item
- pending claims
- claims requiring review
- unresolved item issues
- failed print jobs
- next required action
- responsible user or shared queue
- notes
- blocked reason
- relevant date/time

**Rules:**
- **Handoff does not grant missing permission.**
- **Exact acknowledgement remains To be confirmed.**

### 12.61 For Invoice Customer-Message Boundary

Section 12 only establishes the **handoff:**
```
Confirmed Claims
→ For Invoice
→ Invoice Draft
→ customer-message preparation
```

- **Detailed message preparation belongs to Section 15.**
- **Detailed delivery/retry/status belongs to Section 26.**

### 12.62 Customer Message Contents

The prepared customer message may later include:
- customer name
- item description
- item code
- grams per piece
- quantity
- item amount
- grouped total
- payment arrangement
- fulfillment method
- payment instructions
- deposit requirement
- hold deadline
- approved contact instructions
- **official references only after creation**

**Do not finalize a template here.**

### 12.63 Before Approve & Send Invoice

- The message is a **draft or preview.**
- **No Official Order exists.**
- **No order number.**
- **No invoice number.**
- **No three-day hold.**
- **No false official references.**

### 12.64 After Approve & Send Invoice

- **One Official Order exists.**
- **One order number exists.**
- **One invoice number exists.**
- **The shared three-day hold starts.**
- **The final message may contain official references.**

### 12.65 Manual-Send Fallback

Version 1 baseline:
```
Prepare
→ Preview
→ Copy
→ staff manually sends through an approved channel
→ staff marks/records Sent where permitted
```

**Rules:**
- **The system remains usable without integration.**
- **Copy does not mean Sent.**
- **Mark as Sent does not prove delivery.**
- **Exact channel/status model remains To be confirmed.**

### 12.66 Conditional Direct Send

When a validated integration exists:
- create the Official Order and references;
- start the hold;
- attempt direct send;
- record success/failure;
- **preserve the manual fallback.**

**Rules:**
- **Pancake/Meta direct send remains unverified.**
- **Do not promise it in Version 1.**

### 12.67 Meaning of Approve & Send Invoice

The approved term **Approve & Send Invoice** is kept.

**Mode A — without direct integration:**
- creates the Official Order;
- generates the final message;
- staff manually sends.

**Mode B — with validated integration:**
- creates the Official Order;
- attempts direct send;
- falls back manually if needed.

**Rules:**
- **Future button-label reconciliation remains To be confirmed.**
- **Do not rename it in Section 12.**

### 12.68 Message Status Concepts

Conceptual only:
- Message Draft
- Ready to Copy/Send
- Manually Sent
- Direct Send Pending
- Direct Send Failed
- Delivered
- Read

**Rules:**
- **Not official statuses.**
- **Section 22 owns status names.**
- **Section 26 owns delivery, retry, reminders, and delivery confirmation.**

### 12.69 Message Error and Retry Boundary

Considered cases:
- generation failure
- copy failure
- direct send unavailable
- direct send failure
- duplicate send attempt
- staff forgets Mark as Sent
- wrong message details
- changed official references
- network retry

**Rules:**
- **No duplicate Official Order.**
- **Send failure does not erase the order.**
- **Retry does not recreate the order.**
- **The manual fallback remains.**
- **Exact recovery belongs to Sections 26 and 32.**

### 12.70 Unauthorized Action Behavior

Unauthorized actions may be:
- hidden
- disabled
- blocked
- routed to escalation

**Rules:**
- **Unauthorized attempts do not change records.**
- **Record visibility does not grant authority.**
- **Exact UI/security behavior belongs to Sections 21, 30, and 32.**

### 12.71 Entry and Exit Points Across Modules

**Entry:**
- Dashboard
- Live Batch
- Orders Manual Entry
- Claims
- active batch
- Current Flex Item
- Customer/Profile context where later approved

**Exit/handoff:**
- Pending Claim
- Claim Review
- Confirmed Claim
- For Invoice
- Print Queue
- Waitlist/Excess
- Inventory Review
- Historical Batch View

### 12.72 Section Boundaries

- **Section 12** owns Live Selling and high-level post-live intake.
- **Section 13** owns detailed capture methods.
- **Section 15** owns invoice and message preparation.
- **Section 19** owns inventory effects.
- **Section 21** owns exact buttons.
- **Section 22** owns official statuses/transitions.
- **Section 23** owns detailed search.
- **Section 24** owns print queue/reprint.
- **Section 25** owns reporting.
- **Section 26** owns messaging/reminders/delivery.
- **Section 27** owns printer integration.
- **Sections 28–32** own data integrity, APIs, security, audit, and recovery.

### 12.73 Edge Cases

- no Current Flex Item
- item incomplete
- Current Flex changes mid-entry
- duplicate capture by two staff
- same buyer/same item duplicate
- same buyer/different items
- similar Facebook names
- unclear miner order
- unique item with 1st and 2nd Miner
- multi-stock excess
- failed print
- internet interruption
- screenshot/camera unavailable
- post-live manual entry without an active batch
- selected existing item edited accidentally
- duplicate manual entry
- ending live with unresolved claims
- batch closed while downstream work remains
- reopened batch request
- message send failure after Official Order creation
- migration accidentally entered through live intake

### 12.74 Open / To-Be-Confirmed Items

- final Live Batch statuses
- required batch fields
- batch reference format
- planned vs actual times
- create/start/end/close/reopen authority
- one Current Flex Item rule
- responsible/participating staff model
- item-edit cutoff
- item-withdrawal authority
- inventory-impact point
- duplicate warning method
- tie/unclear miner handling
- unique-item priority window
- pause/resume behavior
- batch closure criteria
- batch reopening authority
- unsold-item disposition
- batch summary counts
- offline/manual fallback recording
- re-live recovery
- all technical integration validation
- final manual-entry action name
- final Orders placement
- secondary manual-entry entry points
- exact manual-entry fields
- source-marker options
- existing item vs new item creation
- post-live item-creation authority
- item-photo vs evidence-photo rules
- evidence requirements by source
- photo count/size/type
- manual-entry permission
- message template
- approved sending channels
- meaning of Send without integration
- Mark-as-Sent evidence requirements
- message-status model
- direct-send retry
- duplicate-send prevention
- Pancake/Meta validation
- button-label reconciliation
- Section 4–5 permission reconciliation

### 12.75 Section 12 Summary

- A **Live Batch organizes a selling session** and is separate from the Facebook broadcast.
- The **Current Flex Item drives during-live intake only.**
- **Post-live manual entry is available from the Orders workspace.**
- **Both intake paths create Pending Claims.**
- **Claim Review remains mandatory.**
- **Confirm Claim & Print Label creates no Official Order.**
- **Approve & Send Invoice remains the only Official Order creation point.**
- **Unique-item and multi-stock rules remain staff-reviewed.**
- **No automatic transfer, allocation, merge, print success, or message delivery is introduced.**
- **The manual copy/send fallback preserves usability without integrations.**
- **Unresolved batch and claim work remains visible.**
- **Exact permissions, statuses, integrations, and inventory timing remain To be confirmed.**

---

*End of Section 12 — Live Selling Workflow. **APPROVED.** Section 13 — Facebook Live Capture Workflow follows.*

---

## Section 13 — Facebook Live Capture Workflow

### 13.1 Purpose of the Facebook Live Capture Workflow Section

This section defines the detailed **capture-method behavior** by which authorized staff turn Facebook Live-related activity into a **Pending Claim** in Version 1 (MineFlow). Where Section 12 owns the broader Live Selling business workflow, **Section 13 owns *how* a claim is captured** — the manual, screenshot, iOS, and planned Android methods, the provisional information each produces, and the handoff to Claim Review.

**Governing scope statements:**

- **Capture creates a Pending Claim only** — nothing is confirmed, printed, invoiced, or ordered here.
- **Capture never reads Facebook, screenshots, or images automatically** — a human staff member records the provisional information.
- **Item details come from the Current Flex Item** (Section 12.15) for during-live capture, not from the screenshot.
- **Capture feeds Claim Review** (Section 6.4, Section 9.7), which resolves customer, item, miner position, quantity, and readiness for confirmation.

This section stays business-focused and staff-facing. It does not define database schema, APIs, code, OCR, automatic screenshot or comment reading, actual camera or file implementation, actual Facebook/Meta or Pancake implementation, printer behavior, exact button behavior, final status-transition logic, or technical retry/locking. It introduces no new permissions, statuses, integrations, automatic behavior, or technical commitments beyond approved Sections 1–12, and it does not silently resolve any To-be-confirmed item.

### 13.2 Governing Capture Rules

1. **Capture/manual entry creates a Pending Claim only.**
2. **No OCR.**
3. **No automatic screenshot reading.**
4. **No automatic Facebook comment reading.**
5. **No automatic buyer identification.**
6. **No automatic customer match.**
7. **No automatic miner-position detection.**
8. **No automatic stock allocation.**
9. **No automatic claim confirmation.**
10. **No automatic physical printing.**
11. **No invoice is created by capture.**
12. **No Official Order is created by capture.**
13. **No direct Facebook/Meta capability may be promised.**
14. **Android floating capture remains subject to technical validation.**
15. **iOS Share creates a Pending Claim only.**
16. **Changing the Current Flex Item does not change an existing claim** (Section 11.12, Section 12.17).
17. **Duplicate detection may warn but must not silently delete or merge** (Section 12.30).
18. **Manual entry must remain available where authorized.**
19. **Assignment does not create permission; visibility does not equal action authority** (Section 11.6, Section 11.19).

### 13.3 Relationship to Section 12 and Claim Review

- **Section 12** establishes *that* a claim is captured during-live or entered post-live and *where* those paths sit in the operation.
- **Section 13** establishes *how* the capture is performed and *what provisional record* it produces.
- All capture methods converge on the same output — a **Pending Claim** — and the same next step — **Claim Review** (Section 6.4).

```
Capture method (manual / screenshot / iOS Share / planned Android)
→ provisional Pending Claim
→ Claim Review
```

**Post-live Manual Entry** (Section 12.35–12.43) is also a capture method in the broad sense; its Orders-workspace entry point and item-authority questions remain owned by Section 12, while the field-level capture behavior described here applies consistently.

### 13.4 Capture Methods Overview

Version 1 considers these capture methods:

- **Manual claim entry** — staff type the provisional details directly.
- **Screenshot upload** — staff attach a saved image as evidence and enter the details.
- **iOS screenshot → Share to MineFlow** — staff share a screenshot into the app, which creates a Pending Claim.
- **Planned Android floating Capture Claim** — a planned on-screen companion entry, **subject to technical validation**.

**Rules:**
- **All methods produce a Pending Claim only.**
- **Manual entry must always remain available** as the baseline fallback.
- **Method-specific device and platform feasibility remains To be confirmed** (see 13.29).

### 13.5 Manual Claim Entry

Staff enter the provisional claim details directly, without relying on any image or integration.

- Serves as the **baseline and universal fallback** for every capture situation.
- Requires the applicable **Claim Capture** authority (Section 5.6) and shop/page access.
- **Creates a Pending Claim only.**
- Does **not** confirm, print, invoice, or create an Official Order.

### 13.6 Screenshot Upload

Staff attach a saved screenshot image as **supporting evidence** and enter the provisional details.

- The screenshot is **evidence only** — it is **not read automatically** (no OCR).
- Staff record the buyer name, comment/reference, and other provisional details themselves.
- **Item details come from the Current Flex Item** for during-live capture.
- **Creates a Pending Claim only.**
- **Exact file types, size, and count limits remain To be confirmed** (see 13.29).

### 13.7 iOS Screenshot → Share to MineFlow

On iOS, staff take a device screenshot and **Share it to MineFlow**, which starts a Pending Claim with the image attached as evidence.

- **iOS Share creates a Pending Claim only.**
- **No automatic reading** of the shared image.
- Staff complete or correct the provisional details.
- The **exact share-extension or alternative implementation remains To be confirmed** (see 13.29).

### 13.8 Planned Android Floating Capture Claim

Android is planned to offer a **floating Capture Claim** companion that lets staff start a Pending Claim quickly while the Live is on screen.

- **Planned direction only — subject to technical validation.**
- If unavailable, staff use **screenshot upload or manual entry**.
- **Creates a Pending Claim only** if implemented.
- **Android technical feasibility remains To be confirmed** (see 13.29).

### 13.9 Current Flex Item Dependency (During-Live Capture)

For **during-live capture**, the **Current Flex Item** provides the proposed item association (Section 12.15).

- Staff **verify the Current Flex Item before capturing** a claim.
- The item details on the claim come from the **Current Flex Item record**, not from the screenshot or comment.
- **Switching the Current Flex Item affects only future captures**; existing Pending Claims keep their stored item association (Section 12.17).

### 13.10 No-Current-Flex Blocked State

- When **no Current Flex Item is set**, the **during-live Current-Flex capture action is unavailable or blocked** (Section 12.18).
- Staff may **set a Current Flex Item** or use **another authorized intake path** (including post-live Manual Entry, which is independent of the Current Flex Item).
- **Exact UI treatment belongs to Sections 20 and 21.**

### 13.11 Provisional Buyer Information

Capture may collect **provisional** buyer information:

- Facebook name
- entered customer name
- customer message/reference where applicable

**Rules:**
- Information remains **provisional** until Claim Review.
- **No automatic buyer identification or customer match** (Section 10.2, Section 10.8).
- **A possible-duplicate warning may apply; no automatic merge.**
- **Claim Review owns final customer association** (Section 10.9).

### 13.12 Provisional Comment / Reference

Capture may record the **mine comment or reference** as provisional text/evidence.

- The comment/reference is **entered or attached by staff**, not read automatically.
- It supports later review but **does not confirm the claim**.

### 13.13 Claim Position for Review

- The **miner/claim position is entered or suggested for review** (Section 12.24).
- It is **not automatically detected**.
- **Staff review the evidence; final miner position belongs to Claim Review.**
- **Ties or unclear order require review; no universal tie-breaker is introduced.**

### 13.14 Timestamp and Screenshot Evidence

- Capture may record a **captured or entered date/time** and attach **screenshot evidence**.
- Timestamp and screenshot are **provisional evidence**, not an authoritative ordering mechanism.
- **Screenshots are stored as evidence and never read automatically.**

### 13.15 Take Photo and Upload Photo

Where applicable, capture supports:

- **Take Photo** using the device camera
- **Upload Photo** from the device or gallery

**Rules:**
- A photo may serve as **item photo** or **claim/message evidence**; the two purposes remain distinguished (Section 12.42).
- **No OCR or automatic reading.**
- **Taking or uploading a photo does not confirm the claim, identify the customer, or create an invoice or Official Order.**
- **Actual camera/file implementation belongs to later technical sections.**

### 13.16 Preview, Replace, Remove-Before-Save

Before saving a Pending Claim, staff may:

- **Preview** the selected image;
- **Replace** it;
- **Remove** it before saving;
- attach supporting evidence where permitted.

**Exact number, size, and file-type limits remain To be confirmed** (see 13.29).

### 13.17 Pending Claim Creation (Capture Output)

A successful capture creates:

- one **Pending Claim**
- provisional customer information
- proposed item association (from the Current Flex Item for during-live capture)
- evidence (screenshot/photo where attached)
- captured/entered date and time
- **source marker** (Section 12.26)
- staff attribution

It **does not** create:

- Confirmed Claim
- physical print
- invoice
- Official Order
- stock allocation
- transfer
- customer profile match
- final miner position

### 13.18 Duplicate-Entry Risks

Capture must surface **warnings or review prompts** for duplicate risks, including:

- the same screenshot attached twice;
- the same buyer/comment captured more than once;
- the same buyer claiming the same unique item repeatedly;
- a duplicate save after a network retry;
- a claim already confirmed elsewhere;
- a reused comment reference;
- similar Facebook names.

**Rules:**
- **Warning/review only.**
- **No automatic deletion or merge.**
- **The exact duplicate-detection method remains To be confirmed** (see 13.29).

### 13.19 Multiple Staff Capturing the Same Comment

When two staff capture the same live comment:

- both captures may create **separate Pending Claims**;
- the situation is surfaced for **staff review**, not auto-resolved;
- **no automatic deletion or merge occurs**;
- **Claim Review reconciles** the duplicate.

**Concurrency safeguards at the technical level belong to Sections 28–32** (Section 12.31).

### 13.20 Failed Upload / Save Behavior

When an upload or save fails:

- **no failed action silently creates a duplicate record**;
- **unresolved failures remain visible** to staff;
- staff may **retry or fall back to manual entry**;
- **exact technical retry/recovery belongs to Section 32.**

### 13.21 Manual Fallback

- **Manual claim entry always remains available** where authorized.
- If screenshot, iOS Share, Android capture, or any integration is unavailable, **staff can still create a Pending Claim manually**.
- The system **remains usable without any automatic capture method**.

### 13.22 Capture Permission Boundaries

- **Claim Capture** (Section 5.6) is the primary authority for creating a Pending Claim.
- **Claim Review** remains required and separate for review and correction.
- **Confirm Claim & Print Label** remains a separate permission.
- **Photo/evidence attachment authority and post-live/Orders manual-entry access require Section 4–5 reconciliation** (Section 12.43).
- **No new permission is silently added.**

### 13.23 Staff Attribution

Capture records who performed the action, for example:

- claim captured/entered by
- evidence attached by
- note added by

**Rules:**
- **Attribution belongs to the action, not the role title** (Section 11.43).
- **Reassignment does not erase attribution.**
- **Detailed audit history belongs to Section 31.**

### 13.24 Privacy and Evidence Visibility (Business Level)

At the business level:

- captured **screenshots and photos are treated as customer/transaction evidence**;
- **evidence visibility follows record access** — a user sees capture evidence only for records within their permission and shop/page access (Section 11.6, Section 11.39);
- evidence is **retained with its claim/order** for traceability;
- **exact retention periods, privacy/consent requirements, and data-handling rules remain To be confirmed** and are owned by later security/audit sections (Sections 30–31).

### 13.25 Handoff to Claim Review

Every captured Pending Claim hands off to **Claim Review** (Section 6.4, Section 9.7), which resolves:

- customer association
- item association
- miner position
- quantity availability
- duplicate warning
- allowed corrections
- readiness for confirmation

**Customer Support alone cannot perform Claim Review** (Section 11.10). **Capture does not confirm; Claim Review and Confirm Claim & Print Label remain separate steps.**

### 13.26 Error and Recovery Boundaries

Considered situations:

- internet/connection failure
- screenshot upload failure
- iOS Share unavailable
- Android capture unavailable
- camera unavailable
- photo upload failure
- claim save failure
- duplicate save attempt
- network retry

**Core rules:**
- **Manual entry remains available.**
- **No failed action creates silent duplicates.**
- **Unresolved failures remain visible.**
- **Exact technical retry/recovery/offline behavior belongs to Section 32.**

### 13.27 Section Boundaries

- **Section 12** owns the broader live and post-live workflow.
- **Section 13** owns capture methods.
- **Section 21** owns exact buttons.
- **Section 22** owns statuses.
- **Section 23** owns search.
- **Section 24** owns the print queue.
- **Section 27** owns printer integration.
- **Sections 28–32** own technical implementation, security, audit, and recovery.

### 13.28 Edge Cases

- no Current Flex Item at capture time
- Current Flex Item changes mid-capture
- screenshot attached but details incomplete
- camera or Share unavailable
- Android floating capture unavailable
- duplicate capture by two staff
- same buyer/same unique item captured repeatedly
- similar Facebook names
- unclear miner order
- failed upload or save
- duplicate save after retry
- offline capture attempt
- evidence attached to the wrong provisional claim before save
- capture attempted without permission

### 13.29 Open / To-Be-Confirmed Items

- Android technical feasibility
- iOS share-extension or alternative implementation
- exact screenshot/photo limits (number and size)
- supported file types
- duplicate-detection method
- evidence retention
- capture permission reconciliation (Section 4–5)
- multi-device behavior
- offline behavior
- Facebook/Meta access
- privacy/consent requirements where applicable

### 13.30 Section 13 Summary

- **Capture turns Facebook Live-related activity into a Pending Claim — and nothing more.**
- **Manual entry, screenshot upload, iOS Share, and planned Android capture** all produce a Pending Claim only.
- **No OCR and no automatic reading** of screenshots or Facebook comments; **no automatic buyer, customer, or miner-position detection.**
- **During-live capture depends on the Current Flex Item; no Current Flex Item blocks the Current-Flex capture action.**
- **Switching the Current Flex Item never changes an existing claim.**
- **Duplicate risks are warned and reviewed, never silently deleted or merged.**
- **Manual entry always remains available; the system works without any integration.**
- **No direct Facebook/Meta capability is promised; Android capture stays subject to technical validation.**
- **Capture hands off to Claim Review; confirmation, printing, invoicing, and Official Order creation remain separate, later steps.**
- **Exact device, file, duplicate-detection, retention, privacy, and permission details remain To be confirmed.**

---

*End of Section 13 — Facebook Live Capture Workflow. **APPROVED.** Section 14 — Pancake Integration follows.*

---

## Section 14 — Pancake Integration

### 14.1 Purpose of the Pancake Integration Section

This section defines **Pancake as a conditional, technically unverified integration** for Version 1 (MineFlow). It describes the *possible* business role of a Pancake connection, the *conditions* under which any part of it could be relied upon, and the strict boundaries that protect the approved MineFlow lifecycle if Pancake is used, delayed, degraded, or never available.

**Governing scope statements:**

- **Pancake is not currently used by the business** (Section 1.5, Section 2.2) and its capabilities are **not assumed**.
- **MineFlow must remain fully usable without Pancake.**
- **Any Pancake-assisted intake creates a Pending Claim first** and follows the approved lifecycle unchanged.
- **Nothing in this section promises a Pancake API, feature, credential, price, or approval** — every such item is explicitly **To be confirmed** pending official documentation and testing.

This section stays business-focused. It does not define database schema, API endpoints, request/response formats, tokens, webhook mechanics, code, hosting, OCR, automatic reading, printer behavior, exact buttons, final statuses, or technical retry/locking. Technical implementation belongs to Sections 28–32. It introduces no new permissions, roles, statuses, high-risk categories, automatic actions, or customer-facing features beyond approved Sections 1–13, and it does not silently resolve any To-be-confirmed item.

### 14.2 Governing Pancake Rules

1. **Do not claim a Pancake API exists or supports a feature unless verified.**
2. **Do not invent endpoints, schemas, tokens, webhook behavior, pricing, or approval status.**
3. **Direct Pancake capture or message sending is not guaranteed.**
4. **MineFlow must remain usable without Pancake.**
5. **Manual entry and manual copy/send remain available** at all times.
6. **Pancake data must create Pending Claims first** where claim intake applies.
7. **Pancake must not auto-confirm, auto-allocate, auto-print, auto-invoice, auto-create an Official Order, auto-verify payment, or auto-release fulfillment.**
8. **Failed message sending must not create another Official Order.**
9. **Integration retries must not duplicate claims, orders, or messages.**
10. **Customer and transaction authority remains governed by MineFlow permissions.**
11. **External integration does not override MineFlow's approved lifecycle.**
12. **Technical implementation belongs to Sections 28–32.**

### 14.3 Current Status — Unverified and Conditional

- **The business does not currently use Pancake** (Section 1.5, Section 2.8-A).
- Pancake is treated throughout the Bible as a **planned, unverified integration** (Section 2.5, Section 12.66).
- **No workflow currently depends on Pancake**, and none may be built to depend on it until its capabilities are confirmed against **official documentation and actual testing**.
- Until then, every Pancake capability referenced here is **provisional** and **To be confirmed**.

### 14.4 Purpose of a Possible Pancake Connection

*If* a validated Pancake connection becomes available, its possible business purpose is to:

- help connect the primary Facebook Page to the live-selling workflow;
- **possibly** assist staff with customer-interaction data during and after a Live;
- **possibly** assist with preparing or communicating invoice/order messages.

**All of the above are possibilities, not commitments.** Each depends on verified Pancake capabilities (see 14.9).

### 14.5 Expected Business Benefits (Conditional)

*If verified*, potential benefits may include:

- faster surfacing of customer-interaction references for staff-assisted capture;
- reduced manual copying of customer/message details;
- more convenient message preparation and communication.

**Rules:**
- These benefits are **conditional on verified capability**.
- **No benefit may be assumed, promised to the client, or built as a dependency** before validation.

### 14.6 Possible Comment / Customer / Message Intake

*If verified*, Pancake **might** provide references such as customer-interaction data, comment references, or message references that **assist** staff-assisted capture.

**Rules:**
- Any such intake is **assistive only** — **staff still record and review** the provisional information.
- **No automatic reading, buyer identification, customer match, or miner-position detection** (Section 13.2).
- **Any Pancake-assisted claim intake creates a Pending Claim first** (Section 12.2) and enters **Claim Review**.
- **The exact comment fields and customer identifiers actually available from Pancake remain To be confirmed** (see 14.28).

### 14.7 Possible Invoice / Message Communication

*If verified*, Pancake **might** support communicating invoice/order messages to the customer.

**Rules:**
- Message **preparation** remains owned by Section 15; message **delivery/retry/status** remains owned by Section 26.
- **The manual-send fallback (Section 12.65) remains available in all cases.**
- **Direct sending is conditional** on validated integration (Section 12.66) and **must not be promised** in Version 1.
- **A failed send must not create another Official Order** and **must not erase the existing order** (Section 12.69).

### 14.8 Required Access and Vendor Cooperation

Any Pancake connection would require, at a business level:

- an eligible Pancake account and the business's authorization to connect the primary Facebook Page;
- **vendor cooperation and any required approvals** from Pancake and/or Meta;
- confirmation that the needed capabilities are **officially supported and permitted**.

**Rules:**
- **The availability of the required access, approvals, and cooperation remains To be confirmed.**
- **No credential, approval, or agreement is assumed to exist.**

### 14.9 API Availability Validation

Before any Pancake-dependent behavior is built:

- the **actual availability of a Pancake API** must be validated against **official documentation**;
- the **specific supported features** must be confirmed;
- capabilities must be **tested**, not assumed.

**Rules:**
- **No endpoint, schema, token, webhook, or polling behavior is defined or assumed here.**
- **API availability and supported features remain To be confirmed** (see 14.28).

### 14.10 Authentication / Access Requirements (Business Level)

At a business level, connecting Pancake would involve an **authorized setup step** performed by the Owner or an appropriately authorized user.

**Rules:**
- **Entering third-party credentials/tokens is a controlled, authorized setup activity**, not an ordinary staff action, and its exact handling belongs to the security sections (Sections 30–32).
- **Exact authentication and access mechanics remain To be confirmed** and are **not defined here**.
- **No token format, storage, or scope is invented.**

### 14.11 Supported Page / Account Scope

- Version 1 targets **one business and one primary Facebook Page** (Section 1.5).
- Any Pancake connection would be **scoped to that primary Page/account**, preserving shop/page context (Section 12.7).
- **The exact supported Page/account limits remain To be confirmed** (see 14.28).

### 14.12 Data Mapping Boundaries

*If verified*, mapping Pancake-provided data into MineFlow must respect:

- **provisional-only intake** — Pancake data seeds provisional fields, never final records;
- **staff review** — customer, item, miner position, and quantity are resolved in **Claim Review**;
- **no silent creation** of customers, confirmed claims, invoices, or Official Orders.

**Rules:**
- **The exact available fields and their mapping remain To be confirmed.**
- **No field mapping is assumed or invented here.**

### 14.13 Pancake Intake Creates Pending Claims First

- Where claim intake applies, **Pancake-assisted data creates a Pending Claim first** (Section 12.2, Section 12.25).
- The Pending Claim then follows the **approved lifecycle**: Claim Review → Confirm Claim & Print Label → For Invoice → Invoice Draft → Approve & Send Invoice → Official Order.
- **Pancake does not shortcut, skip, or replace any step.**

### 14.14 Duplicate Prevention

- Pancake-assisted intake must **not create duplicate claims** for the same customer interaction.
- Where a duplicate risk exists, it is **surfaced for staff review** (Section 12.30, Section 13.18).
- **No automatic deletion or merge.**
- **Integration retries must not duplicate claims, orders, or messages** (rule 9).
- **The exact duplicate-prevention method remains To be confirmed** (see 14.28).

### 14.15 Manual Fallback

- **Manual claim entry and manual copy/send remain available at all times** (Section 12.65, Section 13.21).
- If Pancake is unavailable, degraded, or unverified, **staff continue operating manually with no loss of core capability**.
- **MineFlow never becomes unusable due to a Pancake dependency.**

### 14.16 Integration-Unavailable State

When Pancake is not connected or not available:

- MineFlow **operates normally in manual mode**;
- **no Pancake-dependent action is offered as if it were available**;
- **no claim, order, or message is blocked solely because Pancake is offline** — the manual paths remain.

### 14.17 Failed Request Behavior

When a Pancake request fails:

- **no failed request silently creates a duplicate or partial record**;
- **a failed send does not create another Official Order and does not erase an existing order** (rule 8);
- **the failure remains visible** to authorized staff;
- staff **fall back to the manual path**.

**Exact technical failure handling belongs to Section 32.**

### 14.18 Retry Boundaries

- **Retries must not duplicate claims, orders, or messages** (rule 9).
- A retry **re-attempts the same operation safely**, it does not create a second record.
- **Exact retry mechanics, limits, and backoff belong to Sections 26 and 32** and **remain To be confirmed**.

### 14.19 Delivery-Confirmation Limitations

- **Delivery and read confirmation cannot be assumed** and require verified integration support.
- Without verified support, **"Mark as Sent" is a staff confirmation only** and **does not prove delivery** (Section 12.65, Section 12.68).
- **The exact delivery/read-status model remains To be confirmed** and is owned by **Section 26**.

### 14.20 Staff Visibility and Authority

- **Customer and transaction authority remains governed by MineFlow permissions** (Section 5, Section 11).
- **Pancake does not grant authority** — a user still needs the applicable MineFlow permission and shop/page access to act.
- **Visibility of Pancake-assisted data follows record access** (Section 11.39).
- **No new permission or role is introduced by this section.**

### 14.21 Attribution

- Actions taken with Pancake-assisted data remain **attributable to the individual staff account** (Section 11.43).
- **Attribution belongs to the action, not to the integration.**
- **Detailed audit behavior belongs to Section 31.**

### 14.22 Privacy and Security Boundaries

- Pancake-provided data is treated as **customer/transaction data** subject to the same access rules as other records (Section 13.24).
- **Third-party credentials and access are handled as controlled, authorized setup**, not ordinary staff actions.
- **Exact privacy, consent, data-retention, and security requirements remain To be confirmed** and belong to **Sections 30–31**.
- **No data-sharing, storage, or transmission behavior is defined or promised here.**

### 14.23 Disconnection / Revocation

- The business must be able to **disconnect or revoke** a Pancake connection.
- On disconnection, **MineFlow reverts to manual operation** with no loss of core capability (Section 14.15).
- **Existing records remain intact and attributable.**
- **Exact disconnection/revocation mechanics remain To be confirmed** and belong to the security sections.

### 14.24 Testing and Pilot Requirements

Before any Pancake-dependent behavior is relied upon:

- capabilities must be **validated against official documentation**;
- a **controlled test/pilot** must confirm real behavior;
- **manual fallback must be verified to remain fully functional** during and after the pilot.

**Rules:**
- **No Pancake behavior is enabled in production before validation and pilot.**
- **The exact testing environment and vendor support availability remain To be confirmed.**

### 14.25 Production-Readiness Criteria

A Pancake capability may be considered production-ready **only when**:

- the specific capability is **officially documented and permitted**;
- it has been **tested and passed a controlled pilot**;
- **duplicate prevention and retry-safety are verified**;
- **the manual fallback remains intact**;
- **required access, approvals, and any vendor agreement are in place**.

**Until all criteria are met, the capability remains conditional and is not relied upon.**

### 14.26 Section Boundaries

- **Section 14** owns the business definition of the conditional Pancake integration.
- **Section 12** owns the live/post-live workflow that any Pancake-assisted intake must follow.
- **Section 13** owns capture-method behavior.
- **Section 15** owns invoice and message preparation.
- **Section 26** owns message delivery, retries, reminders, and delivery status.
- **Sections 28–32** own technical implementation, APIs, security, attribution, and recovery.

### 14.27 Edge Cases

- Pancake account or Page authorization unavailable
- API not available or feature unsupported
- partial capability (intake but not sending, or vice versa)
- credentials expire or are revoked mid-operation
- Pancake returns incomplete or ambiguous data
- duplicate interaction surfaced from Pancake
- send attempt fails after Official Order creation
- retry after a timeout or network drop
- delivery/read status unavailable
- Pancake offline during a Live
- disconnection requested mid-session
- vendor pricing or approval not finalized

### 14.28 Open / To-Be-Confirmed Items

- actual Pancake API availability
- supported features
- access credentials and approval
- webhook or polling availability
- comment fields available
- customer identifiers available
- message-send capability
- delivery/read status
- rate limits
- vendor pricing
- data retention
- Page/account limits
- failure/retry behavior
- testing environment
- vendor support
- production agreement

### 14.29 Section 14 Summary

- **Pancake is a conditional, technically unverified integration** — nothing about its API, features, credentials, pricing, or approval is assumed.
- **MineFlow must remain fully usable without Pancake**, with **manual entry and manual copy/send always available**.
- **Any Pancake-assisted intake creates a Pending Claim first** and follows the approved lifecycle unchanged.
- **Pancake must not auto-confirm, auto-allocate, auto-print, auto-invoice, auto-create an Official Order, auto-verify payment, or auto-release fulfillment.**
- **A failed send never creates another Official Order or erases an existing one; retries never duplicate claims, orders, or messages.**
- **Authority stays with MineFlow permissions; external integration never overrides the approved lifecycle.**
- **Delivery/read confirmation, privacy, security, retries, and technical behavior are deferred** to Sections 26 and 28–32.
- **Validation, a controlled pilot, and explicit production-readiness criteria** gate any real reliance on Pancake, and **every unresolved capability remains To be confirmed.**

---

*End of Section 14 — Pancake Integration. **APPROVED.** Section 15 — Invoice Workflow to follow.*

---

## Section 15 — Invoice Workflow

### 15.1 Purpose of the Invoice Workflow Section

This section owns the complete **Invoice Preparation workflow** in Version 1 (MineFlow): from complete Confirmed Claims in For Invoice, through Invoice Draft building and grouping, customer-message preparation, **Approve & Send Invoice**, Official System Order creation, official references, the shared three-day hold, and send/manual-send handling.

**Governing scope statements:**
- **A Confirmed Claim is not an invoice or Official Order** (Section 4.8, Section 6.4).
- **Approve & Send Invoice is the single Official Order creation point** (Section 4.10, Section 6.8).
- **Message preparation lives here; message delivery/retry/status belongs to Section 26** (Section 12.61).

This section stays business-focused. It does not define database schema, APIs, code, invoice-number generation internals, OCR, actual message-sending implementation, printer behavior, exact button behavior, or final status-transition logic. It introduces no new permissions, roles, statuses, high-risk categories, automatic behavior, accounting rules, payment methods, integrations, or customer-facing features beyond approved Sections 1–14, and it does not silently resolve any To-be-confirmed item.

### 15.2 Governing Invoice Rules

1. A Confirmed Claim is **not** an invoice or Official Order.
2. Confirm Claim & Print Label routes the claim to **For Invoice only**.
3. **For Invoice** contains complete Confirmed Claims ready for invoice review.
4. Claims may group **only** when they share: **same customer, same payment arrangement, same fulfillment arrangement.**
5. **Different arrangements require separate Invoice Drafts and Official Orders.**
6. **One claim cannot exist in multiple active Invoice Drafts.**
7. Invoice Preparation **consumes the customer association already resolved on the claim** (Section 10.14).
8. Invoice Preparation **must not silently switch customer identity.**
9. **Incorrect claims are removed from the draft and returned to the appropriate correction path.**
10. Successful **Approve & Send Invoice** creates **one Official System Order, one official order number, one invoice number, and one shared three-day hold.**
11. **Included claims retain their claim/reference numbers.**
12. **Retrying the action must not create another Official Order.**
13. **Claims included in the Official Order are not counted as additional orders** (Section 6.20, Section 10.28).
14. **Before successful approval:** no Official Order, no order number, no invoice number, hold not started.
15. **After successful approval:** official references exist, the hold starts, the final message may include official references.
16. **Required Payment / Deposit Verified does not automatically mean Paid in Full.**
17. Invoice Preparation permission is **separate from Payment Verification.**
18. Invoice Preparation permission is **separate from fulfillment authority.**
19. **Official-order cancellation remains high-risk and Owner-approved** (Section 5.8, Section 9.16).
20. **No automatic** inventory return, claim transfer, payment verification, fulfillment release, or cancellation occurs.

### 15.3 For Invoice Entry Criteria

- A claim reaches **For Invoice** only after **Confirm Claim & Print Label** (Section 6.4).
- **Complete** Confirmed Claims are eligible for invoice review; incomplete claims remain in For Invoice or return to correction.
- For Invoice shows **individual confirmed claims not currently in an active Invoice Draft** (Section 7.10, Section 8.5-C).

### 15.4 Invoice Draft Lifecycle

Business stages (**status candidates only; Section 22 owns final names/transitions**):
```
For Invoice (individual confirmed claim)
→ added to Invoice Draft (grouped)
→ Invoice Review
→ Approve & Send Invoice
→ Official System Order
```
- An **Invoice Draft is not an Official Order** (Section 9.8).
- An unsent draft may be **edited, have claims removed, or be dissolved**; removed/dissolved claims may return to For Invoice.

### 15.5 Claim Selection and Grouping Rules

- Staff select **complete Confirmed Claims** for one buyer.
- **Grouping requires same customer + same payment arrangement + same fulfillment arrangement** (rule 4).
- **Different arrangements → separate drafts/orders** (rule 5).
- Grouped claims **retain their own claim/reference numbers** (Section 6.7).

### 15.6 Mixed Live and Post-Live Claims

- **Live and post-live Manual-Entry claims may be grouped together** when they share the same customer and the same payment and fulfillment arrangement (Section 12.34).
- Source marker does not block grouping; **arrangement compatibility governs grouping**, not origin.

### 15.7 Arrangement and Association Checks

- **Customer association** must already be resolved on the claim (Section 10.14); Invoice Preparation **does not create or switch customer identity**.
- **Payment arrangement** and **fulfillment arrangement** must match across grouped claims.
- A claim with an inconsistent association or arrangement is **removed and returned to the pre-invoice correction path** (Section 10.15).

### 15.8 Incomplete Claim Handling

- **Complete claims may be invoiced while incomplete claims remain For Invoice** (Section 6.7).
- Incomplete claims are **not silently added** to a draft.

### 15.9 Duplicate Protection and One-Claim-One-Active-Draft

- **A claim cannot appear in For Invoice and an active draft at the same time** (Section 7.10).
- **A claim cannot be in two active drafts** (rule 6).
- Claims removed from an unsent draft may return to For Invoice.

### 15.10 Draft Editing, Removing, and Returning Claims

- Authorized staff may **build, edit, add/remove, or dissolve** an unsent draft.
- Removed or dissolved-unsent claims **return to the appropriate correction path or For Invoice**.
- **No silent customer switch** during editing or at send (Section 10.15).

### 15.11 Grouped Totals

- The draft may show a **grouped total** derived from included claims' total price per piece × quantities.
- **Price per gram is not used** (Section 4.4.2).
- **Outstanding Balance appears only once formally defined** (Section 7.18) — **To be confirmed**.

### 15.12 Invoice and Customer-Message Preview

- Staff may **preview the grouped invoice** and **preview the customer message** before approval.
- **Before approval, the preview shows no official references** (rule 14).

### 15.13 Customer Message Contents and Actions

Business-level actions (**exact button names not finalized**): **Prepare Message · Preview Message · Copy Message · Send Message (where validated) · Mark as Sent (where permitted) · Edit/Retry (where later approved).**

The message may include: customer name · item description · item code · grams per piece · quantity · item amount · grouped total · payment arrangement · fulfillment arrangement · payment instructions · required deposit where applicable · hold deadline · approved business contact instructions · **order number and invoice number only after creation**.

- **Detailed template belongs here/Section 15 planning but is not finalized; delivery belongs to Section 26.**

### 15.14 Before vs After Official References

- **Before Approve & Send Invoice:** message is **draft/preview**; **no order number, no invoice number, no hold**; **no false official references** (Section 12.63).
- **After successful Approve & Send Invoice:** **one order number, one invoice number, hold started**; final message **may include** them (Section 12.64).

### 15.15 Approve & Send Invoice

- Requires **Invoice Preparation** authority (Section 5.6).
- On success, creates **one Official System Order + one order number + one invoice number + one shared three-day hold**; included claims stay linked and retain their claim/reference numbers.
- The approved term **Approve & Send Invoice** is retained; **button-label reconciliation remains To be confirmed** (Section 12.67).

### 15.16 Duplicate-Submit Prevention and Official Order Creation

- **A repeated Approve & Send Invoice action must not create a second Official Order** (rule 12, Section 11.18).
- The Official Order is created **once**; retries re-reference the same order, they do not duplicate it.

### 15.17 Hold Start

- The **shared three-day hold starts after the invoice is successfully sent** (Section 6.9).
- **All claims in the grouped invoice share one hold-start date and deadline**; separate invoices have separate holds.
- **Day 1 / Day 2 / Day 3 reminders anchor to that hold** (Section 4.15) — delivery owned by Section 26.

### 15.18 Manual-Send Mode (V1 Baseline)

```
Prepare → Preview → Copy → staff manually sends via approved channel → staff marks/records Sent where permitted
```
- **Copy does not mean Sent.**
- **Mark as Sent does not prove delivery.**
- **The system remains usable without any integration.**

### 15.19 Conditional Direct-Send Mode

- When a **validated integration** exists: create the Official Order and references, start the hold, attempt direct send, record success/failure, **preserve the manual fallback** (Section 12.66).
- **Pancake/Meta direct send remains conditional and unverified** (Section 14).

### 15.20 Mark-as-Sent Boundary

- **Mark as Sent may be a staff confirmation only**; delivery/read confirmation requires supported integration (Section 12.68).
- **Mark-as-Sent proof requirements remain To be confirmed.**

### 15.21 Failed Send, Resend, and Retry

- **A send failure does not create a second Official Order and does not erase the existing one** (Section 12.69).
- **Retry re-attempts sending only**, it does not recreate the order.
- **Resend/retry authority and mechanics remain To be confirmed** (Section 26).

### 15.22 Invoice Correction Before Sending

- Before Approve & Send Invoice, staff may **correct the draft** (add/remove/regroup) within Invoice Preparation authority.
- **No silent customer switch** (Section 10.15).

### 15.23 Correction After Official Order Creation

- After the Official Order exists, invoice correction is **not an ordinary edit**.
- **Original references, financial history, and customer association must not be silently reassigned** (Section 10.17).
- **Whether Owner approval is required for specific post-order invoice corrections remains To be confirmed**; **Section 22 owns resulting status behavior; Section 31 owns audit.**

### 15.24 Cancellation Boundary

- **Cancelling an Official Order is high-risk and Owner-approved** (Section 5.8) — it is **not** part of ordinary Invoice Preparation.
- **No automatic inventory return or claim transfer** on cancellation (Section 6.15).

### 15.25 Staff Attribution

- Records may show **invoice prepared by** and **invoice approved/sent by** (Section 11.43).
- **Attribution belongs to the action; reassignment does not erase it; Section 31 owns audit history.**

### 15.26 Permissions

- **Invoice Preparation** governs draft building, review, and Approve & Send Invoice.
- It is **separate from Payment Verification and from fulfillment authority** (rules 17–18).
- **Message-send / Mark-as-Sent micro-authority and any Orders-manual-entry access require Section 4–5 reconciliation** (Section 12.43). **No new permission is silently added.**

### 15.27 Unauthorized Actions

- Unauthorized invoice actions may be **hidden, disabled, blocked, or routed to escalation**; **attempts change no record** (Section 11.45). Detailed security/error UI belongs to Sections 21, 30, 32.

### 15.28 Error Handling

- **No failed action silently creates duplicates** (Section 11.42).
- **Unresolved failures remain visible.**
- **Exact technical retry/recovery belongs to Section 32.**

### 15.29 Concurrent Staff Work

- Two staff must not create **duplicate Official Orders** from the same draft.
- A claim already added to a draft must not be **double-added**.
- **Latest valid state respected; warn on stale records** (Section 11.42). **Technical concurrency → Sections 28–32.**

### 15.30 Shift Handoff

- Unsent drafts, claims awaiting grouping, and orders awaiting send remain **visible in their queues** across shifts (Section 11.40).
- **Handoff does not grant missing permission.**

### 15.31 Reports and Count Boundaries

- **Invoice/order counts must not be additive** (Section 7.10, Section 10.28): included claims are not counted as extra orders; claims are not orders.
- **Formal reporting belongs to Section 25.**

### 15.32 Edge Cases

- claim incomplete at grouping · mixed live/post-live claims · inconsistent arrangement in a draft · one claim added to two drafts · customer mismatch discovered at review · repeated Approve & Send Invoice submit · send fails after order creation · references change by later correction · draft dissolved after partial grouping · post-order invoice correction request · Owner-approval requirement unclear for a correction.

### 15.33 Section Boundaries

- **Section 15** owns Invoice Preparation and message preparation.
- **Section 16** owns payment. **Section 17** layaway. **Section 18** fulfillment. **Section 19** inventory.
- **Section 21** buttons. **Section 22** statuses. **Section 25** reporting. **Section 26** message delivery/retry/state. **Sections 28–32** integrity/security/audit/recovery.

### 15.34 Open / To-Be-Confirmed Items

- exact Invoice Draft status names
- exact invoice required fields
- invoice number format
- Official Order number format
- exact message template
- approved sending channels
- exact meaning of Send without integration
- Mark-as-Sent proof requirements
- sent/delivered/read model
- resend/retry authority
- post-Official-Order invoice correction
- whether Owner approval is required for specific invoice corrections
- button-label reconciliation
- Paid in Full definition
- Outstanding Balance definition
- exact Section 4–5 permission reconciliation

### 15.35 Section 15 Summary

- **For Invoice holds complete Confirmed Claims; grouping requires same customer + payment + fulfillment arrangement.**
- **Live and post-live claims may group together; different arrangements need separate orders.**
- **One claim, one active draft; no silent customer switch.**
- **Approve & Send Invoice is the only Official Order creation point** — one order, one order number, one invoice number, one shared three-day hold.
- **Retries never create a second order; included claims are never double-counted.**
- **Manual copy/send is the V1 baseline; direct send is conditional and unverified; a send failure never creates or erases an order.**
- **Invoice Preparation is separate from Payment Verification and fulfillment; cancellation stays high-risk and Owner-approved.**
- **Exact fields, formats, template, delivery model, corrections, and permission reconciliation remain To be confirmed.**

---

*End of Section 15 — Invoice Workflow. **APPROVED.** Section 16 — Payment Workflow follows.*

---

## Section 16 — Payment Workflow

### 16.1 Purpose of the Payment Workflow Section

This section owns **payment evidence, payment submission, the Unverified state, required payment/deposit verification, payment history, correction boundaries**, and the relationship between payment and Official Orders, layaway, and fulfillment in Version 1 (MineFlow).

**Governing scope statements:**
- **Payment belongs to an Official Order** (Section 6.10).
- **Recording evidence is not verification** (Section 11.21–11.22).
- **Required Payment / Deposit Verified does not automatically mean Paid in Full** (Section 6.10).

This section stays business-focused. It does not define database schema, APIs, code, payment-gateway behavior, OCR, accounting/bookkeeping, refund/reversal internals, or final status-transition logic. It introduces no new permissions, roles, statuses, high-risk categories, automatic behavior, accounting rules, payment methods, integrations, or customer-facing features beyond approved Sections 1–15, and it does not silently resolve any To-be-confirmed item.

### 16.2 Governing Payment Rules

1. Payment belongs to an **Official Order**.
2. Payment **evidence may be recorded before it is verified**.
3. **Payment evidence recorded by** and **payment verified by** are distinct.
4. **Payment Submitted / Unverified is not verified payment.**
5. **Payment Verification permission is required to verify payment.**
6. **Customer Support cannot verify payment.**
7. **Layaway Monitoring alone cannot verify payment.**
8. **Required Payment / Deposit Verified does not automatically mean Paid in Full.**
9. **Paid in Full remains To be confirmed.**
10. **Outstanding Balance remains To be confirmed.**
11. **Payment records must not be silently moved between Official Orders.**
12. **Wrong-payment-to-order correction requires a controlled path.**
13. **Original evidence, verification state, performer, date, and affected orders remain traceable.**
14. **No reversal, refund, void, transfer, chargeback, accounting, or bookkeeping behavior is invented** unless already approved.
15. **Payment retry or duplicated submission must not create duplicate verified payments.**
16. **Payment verification does not automatically release fulfillment** unless release conditions and permissions are satisfied.
17. **Payment verification does not automatically approve layaway forfeiture.**
18. **Payment verification does not automatically cancel an order.**
19. **Visibility does not equal verification authority.**

### 16.3 Payment Record Definition

- A payment record is **tied to one Official Order** and may include: payment method, amount, reference number, proof-of-payment image, date, time, customer name, related order/invoice, and staff notes (Section 2.6).
- **Accepted payment methods remain To be confirmed** (Section 2.8-C).

### 16.4 Payment Evidence

- Staff may **record or attach payment evidence** before verification (Section 11.21).
- **Recording evidence does not verify the payment** (rule 3).
- **Source/channel reference may be recorded where approved**; exact fields **remain To be confirmed**.

### 16.5 Payment Submission and Unverified State

- A submitted payment first enters **Payment Submitted / Unverified** (Section 6.10).
- **A submitted payment is never automatically treated as verified** (Section 2.6).

### 16.6 Verifier Queue and Evidence Review

- Payments awaiting verification appear in the **Payment Submitted / Unverified** queue for users with **Payment Verification** (Section 7.8).
- The verifier reviews evidence against customer, order/invoice, amount due, method, reference, and date/time (Section 2.6).

### 16.7 Required Amount and Verification Outcome

- Verification confirms the **amount required at the current lifecycle stage** (Section 6.10) — **not necessarily the full item price**.
- A payment is marked **verified only by an authorized staff member** (Section 4.12.4).
- **Rejected, insufficient, or unclear evidence** are handled as **concepts here, not final statuses** — **status names owned by Section 22.**

### 16.8 Multiple, Partial, and Arrangement-Specific Payments

- An order may have **multiple payments** and **partial payments**.
- **Layaway installments** follow Section 17; **shipping deposit + COD** follow Section 18 and the shipping rule below.
- **Exact partial-payment, overpayment, and underpayment behavior remain To be confirmed.**

### 16.9 Shipping Deposit and COD (Business Rule)

- For shipping, **the required deposit is at least ₱1,000**, with an **approved COD balance** that may remain (Section 4.12.2, Section 6.12).
- **Exact category/application rules follow approved business rules and any standing reconciliation** (Section 6.21).
- **This is not redefined as Paid in Full.**

### 16.10 Verification Date and Attribution

- Verification records the **date/time and the verifying staff account** (Section 11.43).
- **Attribution belongs to the action; reassignment does not erase it; Section 31 owns audit.**

### 16.11 Duplicate Evidence and Retry

- **Duplicate evidence or a retried submission must not create duplicate verified payments** (rule 15).
- Duplicate risk is **surfaced for review, not auto-resolved** (Section 12.30).

### 16.12 Wrong-Order Attachment and Controlled Correction

- **Payment records must not be silently moved between orders** (rule 11).
- Correction follows a **controlled path** initiated by **Payment Verification or a later-approved payment-correction authority**; Customer Support and Layaway-Monitoring-alone cannot perform it (Section 11.23).
- **Original evidence, verification state, performer, date, and affected orders remain traceable.**
- **Whether Owner approval is required remains To be confirmed**; **no reversal/refund/void/transfer method is defined here** (Section 11.23).

### 16.13 Payment History

- Payment history is visible on the **Official Order** and in the **customer profile** (Section 8.6, Section 10.18).
- **Viewing history does not grant verification authority** (rule 19).

### 16.14 Dependencies (Fulfillment / Layaway / Cancellation)

- **Verification does not automatically release fulfillment** (rule 16, Section 18).
- **Verification does not automatically approve forfeiture** (rule 17, Section 17).
- **Verification does not automatically cancel an order** (rule 18).
- **Payment must be verified before an item is shipped or released for pickup** (Section 4.12.5).

### 16.15 Payment Note Boundary

- Notes are **staff-attributed** and **do not change** payment state, verification, balances, order, or permissions (Section 10.24, Section 11.38).

### 16.16 Unauthorized Actions

- Unauthorized payment actions may be **hidden, disabled, blocked, or escalated**; **attempts change no record** (Section 11.45). Detailed security → Sections 30, 32.

### 16.17 Error and Retry

- **No failed action silently creates duplicates**; **unresolved failures remain visible**; **exact technical retry/recovery belongs to Section 32.**

### 16.18 Concurrent Verification

- The **same payment must not be verified twice**; **latest valid state respected**; **warn on stale records** (Section 11.42). Technical concurrency → Sections 28–32.

### 16.19 Imported / Migrated Payment History

- Migrated payment history **preserves actual historical values and dates** and is **not recalculated by current rules** (Section 6.20).
- **Migrated-payment correction rules remain To be confirmed.**

### 16.20 Reporting Boundaries

- **Payment summaries may appear in basic reports** (Section 8.15); **formal reporting/reconciliation belongs to Section 25.**
- **Outstanding Balance appears only once defined** — **To be confirmed.**

### 16.21 Edge Cases

- evidence recorded but unverified · partial payment · overpayment/underpayment · multiple payments on one order · duplicate evidence · retried submission · payment attached to wrong order · unclear/insufficient evidence · verification attempted without permission · migrated payment needing correction · verified deposit that is not Paid in Full · COD balance outstanding at fulfillment.

### 16.22 Section Boundaries

- **Section 16** owns payment evidence and verification.
- **Section 15** invoice. **Section 17** layaway. **Section 18** fulfillment. **Section 19** inventory.
- **Section 22** statuses. **Section 25** reporting. **Section 26** reminder delivery. **Sections 28–32** integrity/security/audit/recovery.

### 16.23 Open / To-Be-Confirmed Items

- Paid in Full definition/state
- Outstanding Balance definition
- payment status vocabulary
- accepted payment methods
- evidence requirements by payment method
- exact partial-payment behavior
- exact overpayment/underpayment behavior
- wrong-payment-to-order correction authority
- whether Owner approval is required for some corrections
- refund/reversal/void behavior
- payment receipt behavior
- payment reference format
- payment reconciliation/reporting rules
- migrated-payment correction rules
- exact Section 4–5 reconciliation

### 16.24 Section 16 Summary

- **Payment belongs to an Official Order; recording evidence is not verification.**
- **Only Payment Verification may verify; Customer Support and Layaway-Monitoring-alone cannot.**
- **Required/Deposit Verified ≠ Paid in Full**, which remains To be confirmed alongside Outstanding Balance.
- **Payments are never silently moved between orders; wrong-order correction is a controlled, traceable path.**
- **Duplicate/retried submissions never create duplicate verified payments.**
- **Verification never auto-releases fulfillment, approves forfeiture, or cancels an order.**
- **Shipping uses ≥ ₱1,000 deposit + approved COD, not redefined as Paid in Full.**
- **No refund/reversal/void/accounting behavior is invented; migrated history is preserved.**
- **Methods, vocabulary, correction authority, and reconciliation remain To be confirmed.**

---

*End of Section 16 — Payment Workflow. **APPROVED.** Section 17 — Layaway Workflow follows.*

---

## Section 17 — Layaway Workflow

### 17.1 Purpose of the Layaway Workflow Section

This section owns **Active Layaway creation from an Official Order, the required down payment, term, fee, installment monitoring, due dates, grace period, financer, overdue review, forfeiture eligibility, Owner approval, and migrated layaway handling** in Version 1 (MineFlow).

**Governing scope statements:**
- **Layaway applies to an Official Order** (Section 6.11).
- **Forfeiture is never automatic and requires Owner approval** (Section 4.16, Section 6.11).
- **Recording installment activity is not payment verification** (Section 11.24).

This section stays business-focused. It does not define database schema, APIs, code, interest/accounting logic, auto-debit, credit scoring, or final status-transition logic. It introduces no new permissions, roles, statuses, high-risk categories, automatic behavior, accounting rules, payment methods, integrations, or customer-facing features beyond approved Sections 1–16, and it does not silently resolve any To-be-confirmed item.

### 17.2 Governing Layaway Rules

1. Layaway applies to an **Official Order**.
2. **Minimum down payment is 20%.**
3. **Maximum term is three months.**
4. **Layaway fee formula: ₱150 × grams × number of months.**
5. **Exact fee application timing/category remains To be confirmed if not fully defined.**
6. **Maximum grace period is ten days.**
7. A layaway becomes **forfeiture-eligible; eligibility is not approval.**
8. **Forfeiture requires Owner approval.**
9. **Layaway becomes non-cancellable after deposit** per the approved rule (Section 4.14.5).
10. **Payment Verification and Layaway Monitoring are separate permissions.**
11. **Recording installment activity does not equal verifying payment.**
12. **Active Layaway may already be an Official Order and is not counted as an additional order.**
13. **Migrated layaway is one historical Official Order and also an Active Layaway where applicable, but is not additive.**
14. **Historical layaway values and dates are preserved.**
15. **Current deposit rules are not applied retroactively to migrated records.**
16. **Financer must be tracked where applicable.**
17. **Forfeited-item disposition remains To be confirmed.**
18. **No automatic forfeiture.**
19. **No automatic returned-to-stock action.**
20. **No automatic transfer or waitlist allocation.**

### 17.3 Eligibility for Layaway

- Layaway is an **arrangement on an Official Order** (created via Approve & Send Invoice, Section 15).
- The **layaway payment arrangement** is one of the arrangements that governs invoice grouping (Section 15.5).

### 17.4 Layaway Arrangement Creation

```
Invoice sent (layaway arrangement)
→ minimum 20% down payment verified
→ Active Layaway
```
- **The 20% down payment must be verified** (via Payment Verification, Section 16) before the layaway is Active.

### 17.5 Down Payment, Term, and Grams Basis

- **Minimum down payment = total item price × 20%** (Section 6.10).
- **Maximum term = three months.**
- **Grams (per piece) is the basis for the fee** (Section 4.4.4).

### 17.6 Fee Calculation and Display

- **Layaway fee = ₱150 × grams × number of months** (Section 4.14.3).
- The fee **may be displayed** with the layaway details.
- **How the fee is applied to the balance/installments remains To be confirmed** (Section 6.10); **fee rounding remains To be confirmed.**

### 17.7 Dates and Schedule

- The system may record **start date, installment/due schedule, and end date** within the three-month maximum.
- **Exact installment schedule options and due-date rules remain To be confirmed.**

### 17.8 Financer

- The **financer must be recorded and traceable** where applicable (Section 4.14.6).
- **Exact financer fields/workflow remain To be confirmed** (Section 4.14.7).

### 17.9 Payment Evidence and Verification Boundary

- Installment payments follow the **Payment Workflow** (Section 16): evidence recorded, then verified by **Payment Verification**.
- **Layaway Monitoring alone cannot verify payment** (rule 10–11).

### 17.10 Installment Monitoring and History

- **Layaway Monitoring** may review Active Layaway, record installment-related activity, review due dates, and identify overdue/grace/forfeiture-eligible states (Section 11.24).
- **Installment history is preserved and attributable.**

### 17.11 Remaining Amount, Paid in Full, Outstanding Balance

- **Remaining balance = total item price − actual down payment/payments received** (Section 6.10).
- **A verified installment does not automatically mean Paid in Full** (Section 16); **Paid in Full and Outstanding Balance remain To be confirmed.**

### 17.12 Overdue and Grace Period

- An unmet due date makes the layaway **Overdue**.
- A **maximum ten-day grace period** follows before forfeiture eligibility (Section 4.14.4, Section 6.11).
- **Late-payment handling inside grace, and post-grace handling before Owner approval, remain To be confirmed.**

### 17.13 Forfeiture Eligibility

- After grace, a layaway becomes **Forfeiture-Eligible** (Section 6.11).
- **Eligibility is not approval** (rule 7).

### 17.14 Forfeiture Request and Owner Decision

```
Forfeiture-Eligible
→ authorized requester submits reason + supporting details (Initiate High-Risk Action)
→ Needs Owner Approval
→ Owner approves or rejects
→ handling follows Sections 17, 19, and 22
```
- **Forfeiture is high-risk and requires Owner approval** (Section 5.8, Section 11.30).
- **Forfeiture-request authority, Owner self-action behavior, and rejected-forfeiture handling remain To be confirmed.**

### 17.15 Approved / Rejected Outcome

- On **approval**, the layaway is **Forfeited / Needs Owner Decision** for disposition (Section 6.11).
- **A forfeited item does not automatically return to stock** (rule 19, Section 6.17); **forfeited-item disposition remains To be confirmed.**
- On **rejection**, the layaway remains in its prior state pending further action.

### 17.16 Non-Cancellable-After-Deposit Rule

- **After the deposit, the layaway cannot be cancelled** (Section 4.14.5) because the item goes to the financer.
- **Layaway cancellation correction (if ever permitted) remains To be confirmed.**

### 17.17 Fulfillment Hold

- Fulfillment of a layaway item follows the normal rules (Section 18): **verified required payment before release; normal release is permission-based.**

### 17.18 Customer History

- Layaway history appears in the **customer profile** (Section 10.19), combining new and migrated records, with the **migrated marker where applicable**.

### 17.19 Migrated Layaway

- Migrated layaways **preserve actual historical values and dates**, are **not recalculated** by current rules, and may have **optional historical photos** (Section 6.20).
- A migrated layaway **counts as one historical Official Order and may also appear in Active Layaways, but is not additive** (rules 12–13).
- **Migrated-layaway correction authority remains To be confirmed.**

### 17.20 Correction

- Ordinary layaway monitoring corrections follow **Layaway Monitoring**; **payment corrections follow the controlled payment path** (Section 16.12).
- **No silent reassignment** of a layaway between orders/customers (Section 10.17).

### 17.21 Staff Attribution

- Records may show **layaway updated by**, **approval requested by**, **approval decided by** (Section 11.43). Attribution belongs to the action; **Section 31 owns audit.**

### 17.22 Reminders

- Layaway reminders are **staff-triggered in V1** and anchored to due/grace dates (Section 2.6, Section 4.15).
- **Reminder timing and delivery belong to Section 26** — **exact timing remains To be confirmed** here.

### 17.23 Unauthorized Actions and Errors

- Unauthorized layaway actions may be **hidden, disabled, blocked, or escalated**; attempts change no record (Section 11.45).
- **No failed action silently creates duplicates; unresolved failures remain visible; technical recovery → Section 32.**

### 17.24 Concurrency

- The same installment/forfeiture action must not complete twice; **latest valid state respected** (Section 11.42). Technical concurrency → Sections 28–32.

### 17.25 Reporting and Counting

- **Active Layaways is a distinct, non-additive metric** (Section 7.10, Section 10.28).
- **Formal reporting belongs to Section 25.**

### 17.26 Edge Cases

- down payment below 20% · term beyond three months requested · fee-application ambiguity · missed installment within grace · overdue past grace · forfeiture requested but Owner unavailable · forfeiture rejected · financer not recorded · migrated layaway needing correction · cancellation attempt after deposit · early completion · installment on wrong order.

### 17.27 Section Boundaries

- **Section 17** owns layaway monitoring.
- **Section 16** owns payment verification. **Section 18** fulfillment. **Section 19** inventory (forfeited-item disposition, returned-to-stock).
- **Section 22** statuses. **Section 25** reporting. **Section 26** reminders. **Sections 28–32** integrity/security/audit/recovery.

### 17.28 Open / To-Be-Confirmed Items

- exact fee application point
- fee rounding
- exact installment schedule options
- exact due-date rules
- early completion behavior
- Paid in Full definition
- Outstanding Balance definition
- partial/insufficient installment behavior
- late-payment handling inside grace
- post-grace handling before Owner approval
- forfeiture-request authority
- Owner self-action behavior
- rejected forfeiture handling
- forfeited-item disposition
- layaway cancellation correction
- migrated-layaway correction authority
- reminder timing
- exact Section 4–5 reconciliation

### 17.29 Section 17 Summary

- **Layaway is an arrangement on an Official Order**, Active once the **20% down payment is verified**.
- **Term ≤ 3 months; fee = ₱150 × grams × months; grace ≤ 10 days.**
- **Payment Verification and Layaway Monitoring are separate**; recording installments never verifies payment.
- **Forfeiture eligibility is not approval; forfeiture is high-risk and Owner-approved; nothing forfeits automatically.**
- **A forfeited item never auto-returns to stock; its disposition remains To be confirmed.**
- **Non-cancellable after deposit; financer is tracked; migrated layaways preserve historical values and are never additive.**
- **Fee application, schedule, Paid in Full, Outstanding Balance, and reconciliation remain To be confirmed.**

---

*End of Section 17 — Layaway Workflow. **APPROVED.** Section 18 — Shipping and Pickup Workflow follows.*

---

## Section 18 — Shipping and Pickup Workflow

### 18.1 Purpose of the Shipping and Pickup Workflow Section

This section owns **fulfillment preparation, shipping, pickup, verified payment/deposit checks, normal release, exceptional release, dispatch, handover, completion, staff attribution, and blocked/error handling** in Version 1 (MineFlow).

**Governing scope statements:**
- **Fulfillment belongs to an Official Order** (Section 6.12).
- **Normal release is permission-based; exceptional release is high-risk and Owner-approved** (Section 6.14).
- **Shipping and Pickup share one combined Fulfillment area** (Section 8.9).

This section stays business-focused. It does not define database schema, APIs, code, courier-API behavior, shipping-fee calculation, insurance, accounting, or final status-transition logic. It introduces no new permissions, roles, statuses, high-risk categories, automatic behavior, accounting rules, integrations, or customer-facing features beyond approved Sections 1–17, and it does not silently resolve any To-be-confirmed item.

### 18.2 Governing Fulfillment Rules

1. Fulfillment belongs to an **Official Order**.
2. **Shipping and Pickup are separate fulfillment arrangements.**
3. Claims grouped into one Invoice Draft **must share the same fulfillment arrangement** (Section 15.5).
4. **Normal fulfillment release is permission-based, not Owner-only.**
5. **Exceptional release is high-risk and requires Owner approval.**
6. **Preparation does not automatically mean release.**
7. **Required Payment / Deposit Verified does not automatically mean Paid in Full.**
8. **Shipping may proceed based on approved deposit/COD conditions.**
9. **Shipping requires at least ₱1,000 deposit plus approved COD balance where applicable.**
10. **Customer Support cannot release fulfillment** without the required permission.
11. **Layaway Monitoring does not grant fulfillment release.**
12. **Payment Verification does not automatically perform fulfillment release.**
13. **No automatic release.**
14. **No automatic dispatch.**
15. **No automatic pickup completion.**
16. **No automatic exceptional release.**
17. **No automatic stock return upon failed fulfillment.**
18. **An exceptional-release request does not itself release the item.**
19. **Owner approval resumes the applicable workflow but does not bypass other required details.**

### 18.3 Fulfillment Arrangement Selection

- Each Official Order carries a **shipping or pickup** arrangement, set when its claims were grouped (Section 15.5).
- **Fulfillment combines shipping and pickup in one area** (Section 8.9) with separate queues.

### 18.4 Shipping Preparation

- Authorized **Shipping / Pickup Preparation** users may review details, prepare items, confirm the payment/deposit requirement, and enter/verify shipping details (Section 11.25).
- Shipping details may include **courier, shipping date, shipping/tracking number, shipping fee, receiver information, proof of shipment where applicable** (Section 2.6).

### 18.5 Pickup Preparation

- Authorized users may prepare the pickup item, verify permitted pickup details, review the payment/deposit requirement, and prepare receiver/handover information (Section 11.26).
- Pickup details may include **scheduled pickup date, order number, person receiving, confirmation/proof of release, releasing staff, completion date/time** (Section 2.6).

### 18.6 Required Customer and Contact Details

- Shipping may require **shipping address and approved contact details**; pickup may require **pickup-person details**.
- **Exact required shipping/pickup fields and contact-field approval remain To be confirmed** (Section 10.5).

### 18.7 Payment / Deposit Check and COD

- **Payment must be verified before an item is shipped or released for pickup** (Section 4.12.5).
- For shipping, **≥ ₱1,000 deposit + approved COD balance** may apply (Section 4.12.2); the **COD balance may remain until delivery** (Section 6.12).
- **Required/Deposit Verified is not Paid in Full** (rule 7).
- **Exact COD rules remain To be confirmed.**

### 18.8 Layaway Restriction

- Layaway fulfillment follows Section 17 (item goes to the financer; non-cancellable after deposit). Fulfillment does not override layaway rules.

### 18.9 Preparation State

- **Preparation does not automatically mean release** (rule 6).
- An order in **For Preparation / For Shipping / For Pickup** is being readied, not yet released.

### 18.10 Normal Release Eligibility and Authority

- **Normal release** requires: verified required payment/deposit, complete preparation, no mismatch/dispute/exception, and approval by **Shipping / Pickup Preparation** authority (Section 6.14).
- **Owner approval is not required for every normal dispatch** (Section 6.12).

### 18.11 Exceptional Release Request

```
authorized requester (Initiate High-Risk Action)
→ exceptional release request + reason + supporting info
→ Needs Owner Approval
→ Owner approves or rejects
→ fulfillment resumes only after decision
```
- **Exceptional release** covers release without verified required payment, unpaid balance outside the approved arrangement, mismatch/dispute, incomplete requirements, manual override, or action beyond assigned authority (Section 6.14).
- **The request does not itself release the item** (rule 18).
- **Exceptional-release evidence requirements and Owner self-action/delegation remain To be confirmed.**

### 18.12 Dispatch and Pickup Completion

- **Shipping:** after approved release → **Dispatched → Delivered → Completed** (Section 6.12).
- **Pickup:** after approved release → **Picked Up → Completed** (Section 6.13).
- **No automatic dispatch or pickup completion** (rules 14–15).

### 18.13 Failed Delivery and Unclaimed Pickup

- **Failed delivery** and **unclaimed pickup** are recognized situations that keep the item/order in a **visible, unresolved fulfillment state**.
- **No automatic stock return** (rule 17); any exit to stock goes through **Returned-to-Stock Review** (Section 19).
- **Failed-delivery, unclaimed-pickup, re-delivery, and return-to-sender workflows remain To be confirmed.**

### 18.14 Wrong Fulfillment Details and Correction

- Wrong courier/tracking/receiver/pickup details follow a **correction path within the owning module**; later-stage records are progressively restricted (Section 11.44).
- **Wrong-fulfillment correction authority remains To be confirmed.**

### 18.15 Staff Attribution

- Records may show **fulfillment prepared by, released by, dispatched by, pickup completed by** (Section 11.43). Attribution belongs to the action; **Section 31 owns audit.**

### 18.16 Notes

- Notes are **staff-attributed** and **do not change** fulfillment, payment, or order state (Section 11.38).

### 18.17 Unauthorized Actions

- Unauthorized fulfillment actions may be **hidden, disabled, blocked, or escalated**; attempts change no record (Section 11.45). Detailed security → Sections 30, 32.

### 18.18 Errors and Retries

- **No failed action silently creates duplicates or a stock return; unresolved failures remain visible; technical recovery → Section 32.**

### 18.19 Concurrent Work

- The same release/dispatch/handover must not complete twice; **latest valid state respected** (Section 11.42). Technical concurrency → Sections 28–32.

### 18.20 Reminders and Notifications Boundary

- Fulfillment-related notifications (e.g., tracking sent to the customer) are **staff-triggered** with delivery owned by **Section 26**.

### 18.21 Migrated Active Fulfillment

- Migrated records in an active fulfillment state **enter fulfillment by their actual status**, keep the **source marker**, and preserve historical values (Section 6.20, Section 7.12).
- **Migrated-fulfillment correction remains To be confirmed.**

### 18.22 Reporting Boundary

- Fulfillment summaries may appear in basic reports; **formal reporting belongs to Section 25.**

### 18.23 Edge Cases

- release attempted before payment verified · preparation complete but not releasable · exceptional release requested but Owner unavailable · exceptional release rejected · COD balance outstanding at delivery · failed delivery · unclaimed pickup · re-delivery requested · return-to-sender · wrong courier/tracking/receiver · pickup by unauthorized person · migrated active fulfillment · Customer-Support attempt to release.

### 18.24 Section Boundaries

- **Section 18** owns shipping/pickup fulfillment.
- **Section 16** payment. **Section 17** layaway. **Section 19** inventory/returned-to-stock.
- **Section 22** statuses. **Section 25** reporting. **Section 26** notification delivery. **Sections 28–32** integrity/security/audit/recovery.

### 18.25 Open / To-Be-Confirmed Items

- exact required shipping fields
- exact required pickup fields
- shipping fee behavior
- courier list
- tracking rules
- receiver-proof requirements
- pickup authorization requirements
- normal release conditions
- exact COD rules
- failed-delivery workflow
- unclaimed-pickup workflow
- re-delivery behavior
- return-to-sender behavior
- wrong-fulfillment correction authority
- exceptional-release evidence requirements
- Owner self-action/delegation
- migrated-fulfillment correction
- fulfillment completion definition
- exact Section 4–5 reconciliation

### 18.26 Section 18 Summary

- **Fulfillment belongs to an Official Order; shipping and pickup are separate arrangements in one combined area.**
- **Payment must be verified before release; Required/Deposit Verified ≠ Paid in Full.**
- **Shipping uses ≥ ₱1,000 deposit + approved COD; the COD balance may remain until delivery.**
- **Normal release is permission-based; exceptional release is high-risk and Owner-approved, and the request alone never releases the item.**
- **Nothing dispatches, completes pickup, releases, or returns stock automatically.**
- **Customer Support, Layaway Monitoring, and Payment Verification do not by themselves grant release.**
- **Failed delivery, unclaimed pickup, re-delivery, return-to-sender, courier/field details, and completion definition remain To be confirmed.**

---

*End of Section 18 — Shipping and Pickup Workflow. **APPROVED.** Section 19 — Inventory Workflow follows.*
