# A.V. Jewelry Operations System — Development Bible

> **Internal Project Name:** MineFlow
> **Client-Facing System Name:** A.V. Jewelry Operations System
> **Document Type:** Single Source of Truth (Development Bible)
> **Status:** In Progress — Sections 1–9 APPROVED (Project Vision; Business Workflow; Current Pain Points; Business Rules; User Roles & Permissions; Complete Order Lifecycle; Dashboard Workflow; Screen Map; Module Breakdown); Section 10 (Customer Workflow) pending

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

*End of Section 9 — Module Breakdown. **APPROVED.** Section 10 — Customer Workflow to follow.*
