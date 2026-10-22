---
name: budget-tracker
description: Make sense of personal spending from bank or card statement exports (CSV) - sort transactions into categories, show where the money goes each month, spot subscriptions and unusual charges, and track a simple budget over time. Use when the user shares a bank export or asks about their spending, savings or subscriptions.
---
# Budget tracker

Everything stays on this PC. Never send statement data to a website, a search query or another service.

## Read the export

- Ask the user to export transactions as CSV from their bank and attach it or give the path.
- Inspect the first lines to find the columns (date, description, amount or debit and credit) and the format: separator (`,` or `;`), decimal mark, date order.
  `Import-Csv -Path $file -Delimiter ';' | Select-Object -First 5`
- Normalize amounts to numbers (spending negative, income positive) and dates to real dates before any total.

## Categorize

- Use clear categories: housing, groceries, eating out, transport, subscriptions, shopping, health, leisure, savings, income, transfers, other.
- Match on the description with simple rules, and show the rules so the user can correct them. Keep transfers between the user's own accounts out of spending.
- Save the rules in `budget-rules.csv` so next month uses the same ones.

## Report

1. Totals per category for each month, and the change from the month before.
2. Recurring charges (same merchant, similar amount, monthly): the subscription list, with a yearly cost for each.
3. Unusual items: duplicates, unexpected fees, much larger than usual charges.
4. Against a budget, if the user has one: what is on track and what is over.

Show numbers in the user's currency and locale. Offer a chart image or a PDF with the documents skill. This is bookkeeping help, not financial advice; for investment or tax decisions, suggest a professional.
