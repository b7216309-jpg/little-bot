---
name: meal-planner
description: Plan a week of meals around the user's tastes, diet, time and budget, use what is already in the fridge, and produce a grocery list grouped by aisle plus simple recipes. Use when the user asks what to cook, wants a weekly menu, a shopping list, or ideas for leftovers.
---
# Meal planner

Realistic meals for real evenings, and one shopping trip.

## Ask (only what is missing)

How many people and meals, diet and allergies, dislikes, cooking time on weekdays, budget, and what is already in the fridge or pantry. Check `memory_search` for preferences saved earlier, and offer to `memory_save` new lasting ones (allergies, dislikes) when memory is on.

## Plan

- Reuse ingredients across the week (a roast chicken on Sunday becomes Monday's wraps) to cut waste and cost.
- Quick meals (under 30 minutes) on busy days, a longer one at the weekend, one batch-cook that covers two meals.
- Balance across the week: vegetables every day, varied proteins, not the same base twice in a row.
- Use what is in the fridge first, oldest items early in the week.

## Deliver

1. The week as a short table: day, meal, time needed.
2. A grocery list grouped by aisle (produce, dairy, meat and fish, dry goods, frozen, other) with quantities for the whole week, minus what the user already has.
3. Short recipes for the meals the user does not already know: ingredients, five or six steps, time.

Offer to save the plan and list as a file (`meal-plan.md`, or a PDF with the documents skill) and send it with `attachment_send`. Prices are estimates; say so.
