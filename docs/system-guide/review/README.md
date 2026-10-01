# Reproducing the second review

These are historical audit probes for the failures observed in Little Bot 0.10.1 at application commit c6b9c1e. They intentionally assert the bad behavior so they can prove it exists. They are **not** regular desired-behavior tests: after repairs, some probes should fail until converted to regression tests for the corrected behavior.

From the repository root, with Node 24+ and installed dependencies:

```powershell
node docs/system-guide/review/reproduce.cjs
node docs/system-guide/review/validate-docs.cjs
```

The reproduction prints JSON. The checked-in evidence.json is the recorded audit result, not overwritten by subsequent probe runs. If needed, redirect output to a new file outside this folder.

## Isolation and limits

- AppManagement, Controller, Store, GoalRunner, Scheduler, EventBus, EventRuntime, schedule management and AgentTools are the production modules.
- Calendar and UI automation IPC functions are extracted from production main.cjs and evaluated with isolated owners, avoiding Electron startup/personal app data.
- Save failures are injected; no real disk is filled or made unwritable.
- Model transport is simulated; the lost-acknowledgement probe deliberately leaves its fake engine active.
- The event blocking/burst probe holds a model-run promise and publishes synthetic events into the real default queue.
- The temporary directory is uniquely created under the OS temp folder and its absolute parent/name are checked before cleanup.
- No personal workspace, saved app state, bank account, goal, browser login, network API or Windows model server is modified.
- The Windows browser check invokes only the installed dependency's --version, at the actual executable path. It does not verify browsing or artificially lengthen the path.
- The documentation validator checks relative links and ownership of all src modules, scripts, integration files and bundled resource descriptions.

The expected records are R1, R2, R2-goals, R3, R2-automations, R4, R5 and R6 with reproduced:true, calendar-extra-evidence with passed:true, and browser-long-path with reproduced:false on the reviewed Windows setup. This is eight manifestations grouped into six review findings.
