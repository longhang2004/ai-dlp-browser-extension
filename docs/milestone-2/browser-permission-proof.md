# M2.1 browser permission proof

Run date: 2026-08-02 (Asia/Ho_Chi_Minh; historical planning-time proof; exact
execution versions below)

This prior proof was not independently rerun in the restricted execution sandbox
used for the current local run; Chromium launches there failed with
`EPERM`/`SIGABRT`. The browser/version rows below therefore remain historical
planning-time evidence from 2026-08-02, and no 2026-08-03 date/version pairing
is implied.

The isolated proof was run with `pnpm test:permission-proof`. It used a
temporary Manifest V3 fixture, browser-level CDP `Extensions.loadUnpacked`, and
a synthetic `claude.ai` route. It recorded no page contents, cookies, account
state, or user data.

The fixture first installs the same temporary extension with the exact scope as
required permissions, then reloaded the same extension path with the
production-shaped optional declaration. This made the API calls deterministic in
headless automation while still exercising the optional declaration, request,
contains, registration, and remove paths. It was test setup only; the production
extension never uses the bootstrap manifest.

| Field                                 | Google Chrome             | Microsoft Edge            |
| ------------------------------------- | ------------------------- | ------------------------- |
| Exact version                         | `150.0.7871.187`          | `151.0.4129.59`           |
| Pattern                               | `https://claude.ai:443/*` | `https://claude.ai:443/*` |
| Declaration accepted                  | `true`                    | `true`                    |
| Request accepted                      | `true`                    | `true`                    |
| Contains accepted                     | `true`                    | `true`                    |
| Remove accepted                       | `true`                    | `true`                    |
| Registration accepted                 | `true`                    | `true`                    |
| Default-port `claude.ai` page matched | `true`                    | `true`                    |
| Alternate-port fixture matched        | `false`                   | `false`                   |

The proof does not substitute `https://claude.ai/*` or any wildcard-port
pattern. It proves only the exact Chrome `150.0.7871.187` and Edge
`151.0.4129.59` executions above; it is not a general browser/version support
matrix. The M2.1 rollback artifact remains ChatGPT-only, while the current M2.2
candidate uses this same exact joint optional pair.
