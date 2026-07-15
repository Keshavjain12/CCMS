# Frontend Environment Config

This folder holds the **runtime configuration** for the CCMS web frontend.
Unlike the backend (which uses a `.env` file read by Node), a browser cannot
read `.env` files — so config is delivered as a small JS file that publishes
`window.CCMS_ENV` before the app boots.

## Files

| File | Purpose |
|---|---|
| `config.example.js` | Committed template. Copy it to make your own config. |
| `config.js` | The **active** config actually loaded by `index.html`. |
| `README.md` | This file. |

## Setup

```bash
# from the frontend/ folder
cp env/config.example.js env/config.js
# then edit env/config.js
```

`index.html` loads `env/config.js` **first**, so every value is available on
`window.CCMS_ENV` by the time the app starts.

## Keys

| Key | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://localhost:3000` | Where the Express backend is running (no trailing slash). Must match the backend `PORT`. |
| `APP_NAME` / `APP_TAGLINE` | — | Branding shown in the top bar and login screen. |
| `TOKEN_STORAGE_KEY` / `USER_STORAGE_KEY` | `ccms_token` / `ccms_user` | `localStorage` keys for the JWT session. |
| `TOKEN_EXPIRY_HOURS` | `8` | Should match backend `JWT_EXPIRES`; used for client-side expiry. |
| `CURRENCY_SYMBOL` | `₹` | Currency prefix for settlement amounts. |
| `API_TIMEOUT_MS` | `15000` | Abort an API request after this many ms so the UI never hangs on a stalled backend. |
| `SHOW_DEMO_ACCOUNTS` | `false` | **Fail-closed.** Shows the seeded login shortcuts *only* when set to the literal boolean `true`. Leave `false` for any real deployment. |
| `DEMO_ACCOUNTS` | `[]` | Seeded sandbox logins (`{ email, password, label, role }`) for the quick-fill buttons. **Dev/sandbox only — never real credentials, never committed.** |
| `DASHBOARD_REFRESH_MS` | `0` | Auto-refresh interval for dashboard KPIs (`0` = off). |

## Security notes

* **The object is frozen.** Both `config.example.js` and your `config.js`
  publish `window.CCMS_ENV` via `Object.freeze({ … })`. The app then re-freezes
  the merged `CCMS.config`. This prevents an XSS-injected script from rewriting
  `API_BASE_URL` at runtime and redirecting API calls (and the JWT bearer
  header) to an attacker-controlled host.
* **Demo credentials never live in the app source.** The seeded quick-fill
  logins are supplied here (in the git-ignored `config.js`), not hardcoded in
  `js/views/login.js`. A production build therefore ships **zero** cleartext
  passwords, regardless of the `SHOW_DEMO_ACCOUNTS` flag.
* **Fail-closed by default.** `SHOW_DEMO_ACCOUNTS` must be the literal `true`.
  A missing, mistyped, or absent flag hides the demo accounts rather than
  exposing them.

## Production note

For a real deployment you should **git-ignore `config.js`** so secrets/hosts
aren't committed, and keep only `config.example.js` in version control. A
suggested `.gitignore` entry:

```
frontend/env/config.js
```
