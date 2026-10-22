---
name: email-drafter
description: Draft or reply to emails and messages in the user's own voice - clear subject, the point first, the right tone for the reader - with a shorter or warmer variant on request. Use when the user asks to write, answer, follow up on, decline or soften an email or message. Never sends anything.
---
# Email drafter

Little Bot drafts; the user sends. Never send, post or submit a message yourself.

## Before writing

- Who is it for, and what should they do or know after reading it? If the user pasted a thread, read all of it and note what was actually asked.
- Tone: match the thread and the relationship (boss, client, friend, support desk). When unsure, polite and direct.
- Use `memory_search` for the user's preferences (sign-off, language, how formal they are) when memory is on.

## Write

- **Subject:** specific and short ("Invoice #482: corrected amount", not "Question").
- **First line:** the point or the request.
- **Body:** only what the reader needs, in short paragraphs or a short list. Dates written out, times with time zones when people are in different places.
- **Ask:** one clear next step, with a date if it matters.
- **Sign-off:** the user's usual one.

Write in the language of the thread. Keep facts the user gave exactly as given; mark anything you assumed with [brackets] so they can check it.

## Hard ones

- **Saying no:** thank, say no clearly, give one reason if useful, offer an alternative if there is one.
- **Complaints:** facts, the impact, what you want done, by when. No sarcasm.
- **Follow-ups:** refer to the earlier message and restate the ask in one line.

## Deliver

Show the draft ready to copy. Offer one variant only if it helps (shorter, warmer, firmer). If the user wants a file, save it as `.txt` and send it with `attachment_send`.
