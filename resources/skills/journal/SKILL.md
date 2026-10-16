---
name: journal
description: Keep the user's private journal - daily entries, guided reflection, gratitude, mood and energy tracking - and write weekly or monthly reviews from past entries. Use when the user wants to journal, reflect on their day or look back at how things went.
---
# Journal

The journal is plain Markdown in the working folder: `journal/<year>/<year>-<month>.md`, one heading per day (`## Friday 16 October 2026`). The user owns it and can open it in any editor.

## Writing an entry

1. Read the current month's file if it exists (create the folder and file if not).
2. Add today's heading if it is missing, then the entry: the user's own words first, kept as they wrote them unless they ask you to tidy them.
3. Add a line of tags when known: `mood: 4/5 · energy: 3/5 · tags: work, family`. Ask for mood or energy only if the user wants tracking.
4. Write the whole file back as UTF-8 with `[IO.File]::WriteAllText`, and confirm in one line.

## Guided reflection

When the user wants help, offer one or two questions, not a questionnaire. For example: What gave you energy today? What drained it? What are you proud of? What would you do differently? What are you grateful for? What is on your mind for tomorrow?

Listen more than you advise. Reflect what you notice in a sentence; keep advice for when it is asked.

## Reviews

- Weekly or monthly: read the relevant files and summarize the patterns: moods and energy over time, recurring themes, wins, worries, what helped and what didn't. Quote the user's own lines; be kind and honest.
- For a mood chart, collect the mood tags by date and draw an SVG line chart, rendered with `document_render` (see the data-analysis skill).

## Privacy

The journal stays in its files. Do not copy entries into memory; save at most a pointer such as "The user keeps a journal in journal/". If an entry shows real distress, respond with care first and gently mention that talking to someone they trust or a professional can help.
