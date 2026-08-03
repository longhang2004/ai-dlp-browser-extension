# M2.1 browser permission proof

Run date: 2026-08-02

The isolated proof is run with `pnpm test:permission-proof`. It uses a temporary
Manifest V3 fixture, browser-level CDP `Extensions.loadUnpacked`, and a
synthetic `claude.ai` route. It records no page contents, cookies, account
state, or user data.

The fixture first installs the same temporary extension with the exact scope as
required permissions, then reloads the same extension path with the
production-shaped optional declaration. This makes the API calls deterministic
in headless automation while still exercising the optional declaration, request,
contains, registration, and remove paths. It is test setup only; the production
extension never uses the bootstrap manifest.

| Field                                 | Google Chrome             | Microsoft Edge            |
| ------------------------------------- | ------------------------- | ------------------------- |
| Exact version                         | `150.0.7871.187`          | `150.0.4078.105`          |
| Pattern                               | `https://claude.ai:443/*` | `https://claude.ai:443/*` |
| Declaration accepted                  | `true`                    | `true`                    |
| Request accepted                      | `true`                    | `true`                    |
| Contains accepted                     | `true`                    | `true`                    |
| Remove accepted                       | `true`                    | `true`                    |
| Registration accepted                 | `true`                    | `true`                    |
| Default-port `claude.ai` page matched | `true`                    | `true`                    |
| Alternate-port fixture matched        | `false`                   | `false`                   |

The proof does not substitute `https://claude.ai/*` or any wildcard-port
pattern. The production artifact remains ChatGPT-only on M2.1.
