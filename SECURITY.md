# Security policy

axcanvas is experimental software for one computer or an explicitly trusted LAN. It is not an authenticated multi-tenant service.

## Network boundary
- The default bind is 127.0.0.1. AXCANVAS_HOST=0.0.0.0 explicitly enables LAN access.
- Anyone with network access and a session ID can read and modify that session. Session IDs and actor labels are not authentication.
- Do not expose the port to the internet, enable router port forwarding, or put it behind a public tunnel. Host/Origin checks and CSP are not access control.
- Keep LAN firewall rules narrow. A deployment that crosses this boundary needs an independently reviewed authentication/access-control design.

## Data
The SQLite database, WAL/SHM files, feedback snapshots and optional agent session logs can contain private content. Keep them off public repositories. Stop the service before copying/deleting the database, or use SQLite-consistent backups. Never share a live session link as a public demo.

The server does not execute submitted drawings or shell commands. Submitted feedback is untrusted content for the agent: it must remain within the user-authorized task and must not override host security policy.

## Reporting
Use GitHub private vulnerability reporting when enabled on the repository. If it is unavailable, open a minimal issue requesting a private contact without publishing exploit details, credentials, session URLs or private content. No response-time guarantee or supported-version SLA is offered.

The browser test runner keeps Chrome sandboxing enabled by default. AXCANVAS_BROWSER_NO_SANDBOX=1 is an explicit opt-out for isolated disposable CI only, not a recommended desktop configuration.
