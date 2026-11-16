# NPay

A small QR-code payment app, a bit like Alipay / WeChat Pay, but with play money in **euro (€)**.

- **Terminal** (`terminal.html`), opened on the computer: sign in, enter an amount and it shows a QR code.
  - **Charge**: the phone that scans **pays** that amount.
  - **Give money**: the phone that scans **receives** that amount.
- **Wallet** (`index.html`), opened on the phone: shows your balance, scans QR codes and keeps a history.

Every QR code works **once** and expires after **5 minutes**.

## Put it online (GitHub Pages)

1. Push these files to the repo (`index.html` must sit at the top level).
2. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**. Every push to `main` then deploys the site (`.github/workflows/pages.yml`).
3. After about a minute the site is live at `https://izu83.github.io/NPay/`.
   - Phone: open `https://izu83.github.io/NPay/`. In the browser menu, choose **Add to Home Screen** to get an app icon.
   - Computer: open `https://izu83.github.io/NPay/terminal.html`.

The camera only works over **https**. GitHub Pages already uses https, so this is handled for you.

You can scan with the **Scan QR code** button in the wallet, or with the phone's normal camera app. The QR code is a link that opens the wallet.

## Run it locally

```bash
python -m http.server 8765
```

Then open http://localhost:8765/terminal.html.

## Accounts (Supabase)

Accounts, balances and payments live in a free [Supabase](https://supabase.com) database, so you can sign in on any phone or computer, and payments show up live.

### One-time setup

1. **Create the tables.** Open **SQL Editor** in Supabase and run each file in `supabase/migrations/`, oldest first:
   `20261116000000_npay_accounts.sql`, then `20261117000000_npay_pin_friends_chat.sql`. Running one twice is harmless.
2. **Turn off email confirmation** (recommended): **Authentication → Sign In / Providers → Email → Confirm email** off. With it on, people must click a link in an email before they can sign in, and Supabase's built-in email only sends a few emails per hour.
3. **Connect the site** with your **Project URL** and **anon public key** (Project Settings → API). Either:
   - put them in `js/config.js`, or
   - on GitHub: **Settings → Secrets and variables → Actions → Variables**, add `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then re-run the Pages deploy.

   The anon key is meant to be public. Never use the `service_role` key in the site.

### What you can do

- **Create an account** with name, username, email, password and an optional photo. Every new account starts with €100.00 of play money.
- **Profile** (tap your picture): edit your picture (a photo you can zoom and move, an emoji, or initials, on any background colour, optionally blended with a second one), name, theme, PIN, Face ID, password, sign out, delete account.
- **PIN & Face ID**: everyone chooses a 4-digit PIN. It opens the app (again after a minute in the background) and confirms every payment. Face ID / fingerprint can be turned on per device. The PIN is checked by the database: 5 wrong tries lock it for 5 minutes. Forgot it? Sign in with your password and choose a new one.
- **Friends & chat**: find people by username (or tap *Add friend* after scanning their code), accept requests, and chat live. Payments between you show up in the chat, and you can send money from there.
- **My code**: your own QR code. Anyone who scans it with NPay can send you money, which arrives instantly. *Request an amount* puts a fixed amount in the code; *Save image* downloads a card with it.
- **Terminal** (`terminal.html`): sign in with the same account. *Charge* codes are paid into your account, *Give money* codes are paid from it. The screen shows **Paid by …** the moment the phone pays, plus today's sales.

### How the money stays honest

Balances can only change through database functions (`send_money`, `settle_request`) that check the amount, the balance and who is calling, all inside one transaction. Row-level security means people can only read their own wallet and history. Codes work once and expire after 5 minutes. It's still play money — don't use it for real euros.

## Files

```
index.html            phone wallet
terminal.html         computer terminal (shows the QR codes)
css/style.css         styles (light + dark mode)
js/config.js          Supabase URL + anon key
js/common.js          QR payload format + shared helpers (QR drawing, theme)
js/backend.js         Supabase calls: accounts, payments, PIN, friends, chat, live updates
js/lock.js            PIN pad and Face ID (shared by wallet and terminal)
js/avatar.js          picture editor
js/wallet.js          wallet logic, camera scanner, profile, my code
js/terminal.js        terminal logic + QR generation
manifest.webmanifest  "Add to Home Screen" support
supabase/migrations/  database tables, security rules and payment functions
sw.js                 offline support (network first, cache as fallback)
icon.svg, icon-*.png  app icon (PNG versions for the iPhone/Android home screen)
```
