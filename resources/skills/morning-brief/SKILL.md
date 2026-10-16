---
name: morning-brief
description: Put together a short daily brief - today's calendar, goals due or at risk, things the user meant to do, and one suggestion for the day. Use when the user asks what is on today, wants a morning brief, or wants one every morning.
---
# Morning brief

## Gather

Use the tools, not guesses:
- `calendar_list` for today and tomorrow (fromLocal = today's date, toLocal = tomorrow's date).
- `goal_manage` with action `list` for active goals, their next step and anything due or blocked.
- `intention_manage` with action `list` for things the user meant to bring up.
- `memory_search` for recent commitments ("promised", "deadline", "due", "send") when the user wants a fuller brief.
- Weather or news only when a web search service is configured. Never invent them.

The current time comes with every request; use it for "today".

## Shape

Twelve lines at most, in your own voice:
1. One greeting line that fits the day (a Monday, a holiday, a busy day).
2. **Today**: timed events in order, with times; all-day events first.
3. **Due or at risk**: goals and commitments with their dates.
4. **Don't forget**: intentions and loose ends.
5. **One suggestion**: the single most valuable first move today, with a short reason.

If everything is empty, say so in one line and offer to plan the day together.

## As a routine

If the user wants it every morning, create it with `schedule_manage`: action `create`, scheduleType `clock`, clockTime such as `08:30`, daysOfWeek `[1,2,3,4,5]` for weekdays, prompt "Give me my morning brief with the morning-brief skill." Set `enabled: true` only when the user asked to turn it on.
