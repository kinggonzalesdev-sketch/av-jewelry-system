# Password Reset — Go-Live Runbook

**Project** `eqfddwxsmzzojuasffjx` · **Prod** `https://avjewelry.online` · flow authored 2026-09-02
(`src/lib/auth/password-reset.ts`, route `src/app/(auth)/reset-password/`).

The **code is done and live**. What remains is **Supabase configuration** (§6) + a **real-email test**
(§7). Both are done by the Owner — they involve secrets (SMTP password, Management API token) that
MineFlow/Claude never handles.

---

## What the flow actually is (so the config matches it)

MineFlow uses Supabase Auth's **6-digit email OTP** recovery — **not** a magic link. Three calls +
a global sign-out:

1. `resetPasswordForEmail(email)` → emails the **6-digit code**
2. `verifyOtp({ email, token, type:'recovery' })` → opens a recovery session
3. `updateUser({ password })` → sets the new password (**min 12 characters**)
4. `signOut({ scope:'global' })` → logs the user out on **every** device

Anti-enumeration: the request screen **always** says *"If an account exists for this email, we've sent
a 6-digit code."* — success or failure. The **only** place the true send result appears is the server
log line `[password-reset] request … ok:true/false` (see §7 troubleshooting).

➡️ **Because it's OTP, the recovery email MUST print `{{ .Token }}` (the code), NOT `{{ .ConfirmationURL }}`.**
That single fact is the most common go-live mistake.

---

## §6 — Configuration (Owner)

Two ways to do each item: **Dashboard** (no token needed — recommended) or **Management API** (curl,
needs the Owner's Personal Access Token). Do **all four**.

### 6.1 Custom SMTP  ← the real blocker
Without custom SMTP, Supabase's built-in mailer only sends to project **team members** and is capped at
a few per hour — password reset will silently fail for real customers/staff.

**Dashboard:** Authentication → **Emails** → **SMTP Settings** → enable **Custom SMTP**, fill:
- Sender email (e.g. `no-reply@avjewelry.online`) + Sender name `A.V. Jewelry`
- Host / Port `587` / Username / Password from your provider (Resend, SendGrid, Postmark, Brevo, or
  Gmail Workspace SMTP). Use a domain you've verified (SPF/DKIM) so mail isn't spam-filtered.

**Management API (Owner runs this — keep the PAT and SMTP password in your own shell, never share them):**
```bash
export PROJECT_REF="eqfddwxsmzzojuasffjx"
export SUPABASE_ACCESS_TOKEN="<your Supabase Personal Access Token>"   # you type this; Claude never sees it
curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "external_email_enabled": true,
    "mailer_autoconfirm": false,
    "smtp_admin_email": "no-reply@avjewelry.online",
    "smtp_sender_name": "A.V. Jewelry",
    "smtp_host": "smtp.your-provider.com",
    "smtp_port": 587,
    "smtp_user": "<smtp-username>",
    "smtp_pass": "<smtp-password>"
  }'
```

### 6.2 OTP length 6 + expiry 600s
The app validates `/^\d{6}$/` and expects a 10-minute code.
**Dashboard:** Authentication → **Sign In / Providers** → **Email** → set **Email OTP Expiration = 600**
(seconds) and **OTP length = 6**.
**API:** add to the same PATCH body: `"mailer_otp_exp": 600` (and `"mailer_otp_length": 6` if your API exposes it).

### 6.3 Recovery email template — must show the code  ← THE ONE THAT BIT US
> ⚠️ **Symptom if this is skipped (observed 2026-09-03):** the email arrives saying *"Follow the link
> below"* with a **Reset password link** (the Supabase default `{{ .ConfirmationURL }}` template).
> Clicking it goes to `…/?code=<uuid>` and **fails**, because MineFlow's screen wants a **typed 6-digit
> code**, not a link — there is no link-handler in the app. Fix = make the email print the code.

**Dashboard:** Authentication → **Emails** → **Templates** → **Reset Password**:
- **Subject:** `Your A.V. Jewelry password reset code`
- **Message body:** delete the default link markup and paste this (it prints the code, no link):
```html
<h2>Reset your password</h2>
<p>Use this 6-digit code to reset your A.V. Jewelry password:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Enter it on the reset screen. It expires in 10 minutes.</p>
<p>If you didn't request this, you can safely ignore this email.</p>
```

### 6.4 URL configuration
> ⚠️ **Symptom if this is skipped (observed 2026-09-03):** the email link pointed to
> `localhost:3000/?code=…` → **ERR_CONNECTION_REFUSED**. That's the dev default Site URL leaking into
> the email. Set it to prod. (After 6.3 the email has no link at all — but still fix this so every other
> auth email resolves correctly.)

**Dashboard:** Authentication → **URL Configuration** → **Site URL** = `https://avjewelry.online`;
ensure it's in the redirect allow-list.

**Leave enabled (already on):** Leaked-password protection (Authentication → Passwords).

---

## §7 — Real-email end-to-end test (Owner)

Do this **after** §6, against prod `https://avjewelry.online`, with a **real mailbox you control**.
Pick a **test account that already exists** in Auth (a staff account or a throwaway you invite) — reset
only works for accounts that exist, and it will **change that account's password**, so don't use a live
staff member mid-shift.

**Test target email:** `__________________________` ← Owner fills in

**Steps**
1. Go to `https://avjewelry.online` → **Forgot password**. Enter the test email → Submit.
   - ✅ Screen shows the generic *"If an account exists…"* message (never reveals existence).
2. Open the mailbox. **Do NOT click any link — copy the 6-digit code.** (After §6.3 there is no link,
   only a code.) The whole reset happens on the same browser tab where you clicked *Forgot password*.
   - ✅ Email arrives within ~1 min, from your sender, **containing a 6-digit code** (not a link).
   - ✅ Not in spam (if it is, fix SPF/DKIM on the sender domain and re-test).
3. Go back to the reset tab and **type the 6-digit code** on the verify screen.
   - ✅ Accepts → advances to "set new password". (Wrong code → "Invalid or expired"; after 10 min →
     "That code has expired. Send a new code.")
4. Set a new password **≥ 12 characters**, confirm it.
   - ✅ Success; you're signed out.
5. Sign in with the **new** password.
   - ✅ Works. Sign in with the **old** password → ✅ rejected.
6. (Session revocation) If that account was signed in on another device, that device is now logged out.
   - ✅ Confirms `signOut({scope:'global'})`.
7. **Reset the test:** if you used a real staff account, have them set their intended password (repeat
   steps 1–5) so nothing is left changed.

**Pass = all ✅ in steps 1–6.**

### Troubleshooting (the UI hides the real error by design)
- **No email / step 2 fails** → the real cause is in the server log, not the screen. Check Vercel logs
  for `[password-reset] request … ok:false error:"…"` (server-side truth), and Supabase **Auth Logs**.
  Almost always an SMTP misconfig (§6.1) or an unverified sender domain.
- **Email arrives but shows a link, not a code** → template still uses `{{ .ConfirmationURL }}`; fix §6.3.
- **"expired" immediately** → OTP expiry too low or clock skew; set 600 (§6.2).
- **Rate-limited during testing** → app throttles 5 requests / 15 min per email, and Supabase throttles
  server-side; wait a few minutes or use a second test email.

### Rollback / safety
Nothing here is destructive. Config is reversible in the Dashboard. No code deploy is required — the app
code is already live; §6 only turns on delivery. The only state a test changes is the **test account's
password** (step 7 restores it).

---

**Owner, I need two things from you to close this out** (both stay on your side — I never handle the PAT
or the SMTP password):
1. A **real test email** for §7 (an existing Auth account, or say the word and invite a throwaway).
2. Which **SMTP provider** you'll use (Resend/SendGrid/Gmail Workspace/…), so I can tailor §6.1's host/port
   and the sender-domain (SPF/DKIM) note to it.
