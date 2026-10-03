# Glass widget mode

Click **Widget** in the top bar, or press **Ctrl+Shift+M**, for a floating Glass conversation. The corner button returns to the full app. The minus button collapses the panel into a pill; click its name to expand it, or its plus button to expand and attach a file. Drag the header or pill's logo to move it.

The pin keeps the widget above other windows. Size, position, pin, collapse, and the last display mode are saved per PC in `display.json` alongside the app's state. Expanded size starts at 420 × 560 and can be resized. The collapsed pill is 310 × 78. Saved bounds are clamped to an available screen.

Both views share the same conversation and controller. Switching transfers the unsent text, Plan choice, and attachment references. Sending, streamed replies, tools, and Stop use the same handlers. The pill shows current activity and a Stop control during a run. Questions and approvals expand the pill. Finish an open dialog or an in-progress file import/send before switching views.

The overflow menu opens Settings or Goals in the full app and offers the existing Compact conversation action. Rich tool pages and the built-in browser stay in the full app; hiding its browser panel leaves the page and ongoing browser work intact. Closing the widget returns to the full app. Close the full app to quit normally.

Glass follows the app's light or dark theme: a pale frosted surface in light, a charcoal one in dark (its dark rules are generated into `dark.css` with the rest of the app). The window itself is fully transparent with no native acrylic or shadow, so only the rounded card shows; Windows would paint those on the whole rectangle. No second engine, model load, or extra inference is started by entering widget mode.

## Verification

`node --test test/desktop-windows.test.cjs` covers window switching, draft sanitization, IPC main-frame trust, collapse positioning, screen recovery, and creation races. `electron test/widget-window-electron.cjs` drives the real secured preload and both app renderers with fixture data. It verifies drafts, Plan, attachments, sending, Stop, approval expansion, pinning, Settings handoff, close-to-full behavior, and display persistence. Screenshots are saved under `.test-data/glass-expanded.png` and `.test-data/glass-collapsed.png`. This test never starts an engine or contacts Strata.
