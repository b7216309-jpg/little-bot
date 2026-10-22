---
name: meeting-notes
description: Turn a meeting transcript, recording notes or a messy chat log into clean notes - a short summary, decisions, action items with owners and dates, and open questions - and offer to put dates in the calendar. Use after a meeting or call, or when the user pastes notes to clean up.
---
# Meeting notes

Capture what was decided and who does what. Leave out the chatter.

## Read

- Read the whole transcript or note before writing. Identify the participants and the date.
- A decision is something the group agreed. An action item has a doer and a thing to deliver. A question is something nobody could answer yet.
- Do not invent owners or deadlines. If one is missing, write "owner?" or "no date".

## Write

```markdown
# <Meeting> · <date>
Present: <names>

## Summary
<Three sentences at most: why the meeting happened and what came out of it.>

## Decisions
- <Decision>, <why, in a few words>

## Action items
| What | Who | By |
|---|---|---|
| <Concrete deliverable> | <Name> | <Date or "no date"> |

## Open questions
- <Question> (<who will find out>)
```

Write it in the meeting's language. Quote numbers, names and dates exactly.

## After

- Save it as `meeting-notes-<date>.md` in the working folder when the user wants to keep it.
- Offer to add dated action items or the next meeting to Little Bot's calendar with `calendar_manage`. Create events only after the user says yes.
- Offer a short recap message for the participants (see the email-drafter skill if it is enabled). Never send it yourself.
