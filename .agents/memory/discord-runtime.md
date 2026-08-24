---
name: Discord bot runtime
description: How the leveling bot is expected to run in this workspace.
---

The Discord client runs in the API service process and is disabled deliberately when its two required secrets are absent.

**Why:** The service must remain healthy for HTTP checks and local development even when Discord credentials are not configured.

**How to apply:** Keep bot startup guarded by secret presence, use the managed API workflow, and never put Discord credentials in source or logs.