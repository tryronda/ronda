# Security policy

Ronda reads private conversations with coding agents, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub private vulnerability reporting](https://github.com/tryronda/ronda/security/advisories/new).

Please include the affected version and platform, steps to reproduce, and the impact you expect. We aim to acknowledge reports within a few days and will keep you updated until a fix ships.

## Supported versions

Security fixes go into the latest release. Update through **Settings → Check for updates** or from the [releases page](https://github.com/tryronda/ronda/releases/latest).

## Scope

Examples of what we want to hear about:

- session content leaving the machine in a way the [privacy documentation](https://tryronda.cloud/docs/#privacy) doesn't describe;
- Ronda changing or deleting agent files outside the explicit **Move to Trash** action;
- the MCP server or CLI exposing more than read-only access to the index;
- command injection through session metadata, for example in **Resume** or remote-host sync;
- script execution in the desktop webview.
