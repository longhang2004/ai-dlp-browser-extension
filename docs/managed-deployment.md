# Managed deployment

Managed deployment is not implemented in Milestone 1. The current extension is
an unmanaged local tool: a user can change exposed settings, disable protection,
disable the extension, or uninstall it.

Do not describe Milestone 1 as enterprise-enforced, tamper-proof, fail-closed at
startup, centrally monitored, or centrally administered.

## Current deployable artifact

Organizations may evaluate the verified unpacked build locally, but the product
currently provides no:

- enterprise policy schema or precedence rules;
- forced-install package or browser-management templates;
- locked settings;
- signed remote policy updates;
- organization identity, SSO, SCIM, or tenant model;
- central audit export, telemetry, SIEM integration, or health dashboard;
- managed fail-closed behavior during settings initialization;
- update service or release-signing workflow.

The short startup interval remains explicitly fail-open: submissions before a
validated settings snapshot are not intercepted, and status is `initializing`,
never `active`.

## Requirements for a future managed milestone

A future design must receive separate approval and define:

- authoritative policy source, schema versioning, signatures, rollback, and
  cache behavior;
- precedence between managed and local settings, including which controls are
  hidden or locked;
- fail-open versus fail-closed startup and outage behavior;
- deployment and update channels for supported Chromium browsers;
- organization identity and device/user scoping;
- privacy-minimized audit export, retention, access control, deletion, and data
  residency;
- health reporting that remains prompt-free;
- tamper and disablement signals without claiming prevention the browser cannot
  provide;
- incident response, recovery, and break-glass behavior;
- an expanded threat model and production artifact/supply-chain verification.

No future management feature should weaken the existing prompt-free policy, UI,
messaging, storage, audit, or logging boundaries.
