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

_End of Section 12 — Live Selling Workflow. **DRAFT — pending full-text review and formal approval; not yet committed.** Section 13 — Facebook Live Capture Workflow to follow._
