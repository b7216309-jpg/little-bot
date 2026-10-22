---
name: flashcards
description: Turn notes, a course, a document or a topic into flashcards and quiz the user with spaced repetition, keeping the deck and each card's schedule in a file. Use when the user wants to study, memorize, revise for an exam, or be quizzed.
---
# Flashcards

Short cards, one fact each, reviewed just before they would be forgotten.

## Make cards

- From the user's material (notes, an attached file, a web page) or a topic they name.
- One idea per card. The front is a precise question; the back is the shortest complete answer.
- Prefer "why" and "how" cards over bare definitions, and add an example where it helps.
- Show the new cards for a quick check before saving them.

## The deck file

Keep `flashcards/<deck>.csv` in the working folder, UTF-8, with these columns:

`front,back,box,due`

- `box` is 1 to 5 (Leitner system). New cards start in box 1, due today.
- Review intervals by box: 1 → 1 day, 2 → 2 days, 3 → 4 days, 4 → 8 days, 5 → 16 days.
- Read and write it with `Import-Csv` and `Export-Csv -NoTypeInformation -Encoding UTF8`.

## Quiz

1. Load the cards due today or earlier, shuffled. Ask one front at a time and wait for the answer.
2. Judge the answer fairly (meaning matters, not exact wording) and show the correct back.
3. Right: move the card up a box and set its next due date. Wrong: back to box 1, due tomorrow.
4. Save the deck after each answer so nothing is lost if the user stops.

End with the score, the cards that were missed, and how many cards are due tomorrow. Offer a daily review reminder with `schedule_manage`; create it only when the user agrees.
