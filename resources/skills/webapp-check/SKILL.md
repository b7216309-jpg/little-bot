---
name: webapp-check
description: Test a local web app in the built-in browser - start its dev server, open the pages, click through the main flows, check for console errors, broken links and layout problems, and return screenshots. Use when the user asks to test, check or demo a website or web app they are building.
---
# Web app check

Test what a user would do, and show the evidence.

## Start it

- Find how the project runs: `package.json` scripts (`dev`, `start`), a README, or a framework default.
- Start the server in the background so the chat stays free:
  `Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory $PWD -WindowStyle Hidden -PassThru | Select-Object Id`
  Note the process Id so you can stop it at the end.
- Wait until the port answers: `Test-NetConnection 127.0.0.1 -Port 5173 -InformationLevel Quiet` (use the project's port), retrying a few times.

## Check

Use `browser` (`navigate`, `snapshot`, `click`, `fill`, `press`, `screenshot`):

1. Open each main page. The page should load with real content, not an error overlay or a blank body.
2. Walk the main flows end to end: sign-up or log-in with test data, create and edit an item, search, submit a form with good and bad input.
3. After each step take a fresh snapshot and confirm what changed.
4. Read the page for error messages, "undefined", "NaN" or placeholder text.
5. Try a narrow window for layout: resize the browser panel or ask the user how the page looks on mobile.

Use only test data. Never enter real passwords, card numbers or personal details.

## Report

A short table: page or flow, result (works, broken, looks wrong), and the evidence. Send the useful screenshots with `attachment_send`. For each problem give the steps to reproduce it. Stop the server when finished: `Stop-Process -Id <Id>`.
