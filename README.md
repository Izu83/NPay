# NPay

A small QR-code payment app, a bit like Alipay / WeChat Pay, but with play money in **euro (€)**.

- **Terminal** (`terminal.html`), opened on the computer: enter an amount and it shows a QR code.
  - **Charge**: the phone that scans **pays** that amount.
  - **Give money**: the phone that scans **receives** that amount.
- **Wallet** (`index.html`), opened on the phone: shows your balance, scans QR codes and keeps a history.

Every QR code works **once** and expires after **5 minutes**.

## Put it online (GitHub Pages)

1. Push these files to the repo (`index.html` must sit at the top level).
2. On GitHub, open **Settings → Pages**. Set **Source** to *Deploy from a branch*, **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
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

## Accounts and your own QR code

- **Create an account** with a name, a username, a password and (optionally) a profile photo. Each new account starts with €100.00 of play money. Several people can have accounts on the same phone; tap one under *On this phone* to sign in.
- **Profile** (tap your picture at the top): change your photo, name and avatar colour, pick a light/dark theme, change your password, sign out, reset your balance or delete the account.
- **My code**: every account has its own QR code. When someone scans it with NPay, they can send you money. Tap *Request an amount* to put a fixed amount (and a note) in the code. *Save image* downloads a card with your code to share.
- **Sending money to a person**: scan their code, enter an amount, send. Because there's no server, the money then shows up as a **claim code** on your screen: the other person scans that once to take the money (valid 7 days, only works for the account it was sent to). You can show it again from your activity.

## How it works right now (and its limits)

GitHub Pages only hosts static files and has no server or database, so:

- Accounts, balances and history are stored **only in that phone's browser** (localStorage). Passwords are kept as a salted PBKDF2 hash, never in plain text. A new account starts with €100.00. A wallet from the old version (before accounts) moves into the first account you create.
- The terminal **can't see** whether a phone actually paid. The person paying shows their "Paid" screen.
- Anyone can make a "Give money" code, so this is for fun or demos, not real money — the euros are pretend.

To add real accounts, live "payment received" on the computer, and phone-to-phone transfers, the next step is a free backend such as Firebase or Supabase. That can still be hosted from GitHub Pages.

## Files

```
index.html            phone wallet
terminal.html         computer terminal (shows the QR codes)
css/style.css         styles (light + dark mode)
js/common.js          QR payload format + shared helpers (QR drawing, theme)
js/accounts.js        accounts: sign up, sign in, passwords, profile photos
js/wallet.js          wallet logic, camera scanner, profile, my code
js/terminal.js        terminal logic + QR generation
manifest.webmanifest  "Add to Home Screen" support
sw.js                 offline support (network first, cache as fallback)
icon.svg, icon-*.png  app icon (PNG versions for the iPhone/Android home screen)
```
