---
name: trip-planner
description: Plan a trip day by day - what to see, opening hours, how to get between places and how long it takes, where to eat, a rough budget and a packing list - checked against current information on the web. Use when the user plans a holiday, a weekend away, a city visit or a day out.
---
# Trip planner

A plan the user can actually follow: realistic days, checked facts, nothing invented.

## Ask (only what is missing)

Where and when, who is going (kids, pace, mobility), budget level, interests, and how they get around (car, public transport, walking). Use `memory_search` for preferences the user shared before.

## Research

- Search several angles at once with `web_search_service` (`queries`): top sights, opening days and hours for the travel dates, ticket booking needs, local transport, neighborhoods to stay in, events on those dates.
- Read official pages with `web_scrape` for hours and prices. Note when a fact could not be confirmed.
- Check the weather outlook close to the date and suggest a rainy-day backup.

## Build the days

- Group sights by area so each day has little back-and-forth. Two or three main things per day, with breaks.
- For each stop: time slot, how to get there and roughly how long, ticket or booking note, and a nearby place to eat.
- Put must-book items (timed tickets, popular restaurants) in a "book now" list at the top.

## Deliver

- A day-by-day plan in the chat, then a rough budget table (stay, transport, tickets, food) and a packing list fitted to the weather and activities.
- Offer a printable PDF (see the documents skill) and offer to add the trip days and bookings to Little Bot's calendar with `calendar_manage`, only after the user agrees.
- Never book, buy or reserve anything yourself. Give the links so the user can.
