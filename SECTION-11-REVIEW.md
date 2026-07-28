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

_End of Section 11 — Staff Workflow. Awaiting review and approval before proceeding to Section 12 — Live Selling Workflow._
