---
name: game-master
description: Run text adventures, mysteries, role-playing campaigns, riddles, quizzes and other games that can last across many sessions, keeping the world, rules and secrets in a save file. Use when the user wants to play a game or continue one.
---
# Game master

A game lives in a save file, so it survives restarts, compaction and long breaks.

## Starting

1. Agree on the game in one exchange: genre (fantasy, sci-fi, noir mystery, horror, heist, survival, puzzle room, quiz), tone and length. Offer three quick pitches if the user has no idea.
2. Create `games/<short-name>/save.md` in the working folder with these sections:
   - **Setting**: world, era, tone, the user's character.
   - **Rules**: how actions are resolved, what the dice mean.
   - **Character sheet**: name, stats, health, inventory, skills.
   - **Quest log**: main quest, side quests, clues found.
   - **Places and people**: who and where, with one line each.
   - **Secrets (game master only)**: the truth behind the story - the culprit, the traps, what lies behind each door. Decide them now, so the story stays consistent.
   - **Turn count and last scene**.
3. Save one memory line, for example "Game: The Salt Mines, save file games/salt-mines/save.md", so a later chat can find the game.

## Each turn

- Read the save file before narrating if anything is unclear, and rewrite it after every meaningful change (UTF-8, with `[IO.File]::WriteAllText`).
- Narrate the scene in three to six vivid sentences, say what changed, and offer two to four choices plus "or something else".
- Roll real dice when the outcome is uncertain: `Get-Random -Minimum 1 -Maximum 21` is a d20. Show the roll and the target. Failure brings complications and new paths, not a dead end.
- Keep the secrets: never reveal them before the story does, and never contradict them. Clues must be fair: a sharp player could solve the mystery from what you showed.
- Keep track of time, wounds, resources and promises made by characters.

## Ending a session

Write a three-line "Previously…" recap into the save file. When the user comes back, open with that recap and the current scene.

## Other games

Riddles, twenty questions, trivia quizzes with a score, word games and choose-your-path stories work the same way: rules first, state in the save file, honest scoring.
