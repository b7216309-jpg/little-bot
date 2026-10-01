# Diagnostics, tests and distribution

## Diagnostics

[ErrorLog](../../src/error-log.cjs) writes rotating JSONL under data/logs. Its default file budget is 2 MiB with three rotated backups. Main registers process/controller diagnostics and renderer error reporting; Settings can open the logs folder.

Engine output, local-provider/Strata logs, UI errors and application state are different evidence sources. A generic idle timeout can originate from provider streaming or a failed engine RPC; inspect the turn ownership and timestamps before assuming nothing ran. R3 in the [review](review.md) documents one host-side recovery hole.

The logger bounds and filters diagnostic payloads. It is not a complete transcript, and absence of a diagnostic line does not prove success. No new redaction/permission system was introduced by this review.

## Test commands

From the repository, with dependencies available:

```powershell
npm run ci
node docs/system-guide/review/reproduce.cjs
node docs/system-guide/review/validate-docs.cjs
```

ci checks JavaScript syntax, runs the Node tests and all 14 Electron fixtures. Pretest prepares the pinned embedding files, checking identity/size/hash and downloading missing assets. The review repro command is intentionally separate: it probes the bad behavior observed at 0.10.1 and is not a desired-behavior regression suite. Read [its instructions](review/README.md) before interpreting results.

Source smoke harnesses exercise startup, attachments, goals, profile, recall and web/settings paths. Some need live connections or credentials. Passing fixture tests is not proof of real third-party login, notification delivery, scheduling while closed or arbitrary model quality.

The fresh second-pass ci run passed 166 JavaScript syntax checks, 453 Node tests and 14 Electron fixtures. Earlier installed-app live Strata evidence on this same application revision is recorded in [VALIDATION.md](../../VALIDATION.md). The live tests used isolated workspace/application state.

## Packaging and installation

[package.cjs](../../scripts/package.cjs) prepares embeddings and packages Windows x64 Electron with pinned production dependencies, excluding development tests/scripts and unsupported platform binaries. It creates a portable ZIP and, on Windows, an installer via [build-installer.ps1](../../scripts/build-installer.ps1). [install.ps1](../../scripts/install.ps1) and [uninstall.ps1](../../scripts/uninstall.ps1) manage local installation.

Package version comes from package.json. Installing a new binary does not deliberately reset personal app data; that data lives outside the installed resources. A partial copy, missing native dependency, unsupported OS/architecture, locked files or a long executable path can prevent launching. The bundled Codex executable uses a namespaced Windows path for long-path launches.

This pass changed documentation/audit evidence only. It did not rebuild/reinstall the app, mutate personal settings, run real goals or alter the Strata configuration.
