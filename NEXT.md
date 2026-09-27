# Possible next additions

Version 0.8 adds attachments, image input/output, a local Qwen connection, and a quieter interface. Keep further additions driven by actual use.

1. **Tray mode and optional start at login.** Keep authorized work running after closing the window, with a visible status and clear Quit command. Sleep still pauses work without an explicit wake mechanism.
2. **One external event source.** A calendar event, inbox change, or webhook could wake a relevant goal, with deduplication and saved authorization.
3. **Provider usage display.** Show reliable provider limits or local performance when available; existing token/time/action budgets remain independent of a pricing service.

Memory stays at three layers. Goal state and audit records remain operational state. No marketplace, vector database, or additional agent loop is required.
