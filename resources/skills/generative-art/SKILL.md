---
name: generative-art
description: Create generative art with code - flow fields, particles, tilings, noise landscapes, geometric patterns - computed from a seed and tunable parameters, written as SVG and rendered to a PNG to send. Use when the user wants abstract art, a wallpaper, a pattern, or "something beautiful made with code".
---
# Generative art

Art from rules and randomness: the same seed always gives the same picture, a new seed gives a sibling.

## Pick an idea

Ask for a mood, colors and a size (wallpaper 2560×1440, square 2048×2048, phone 1290×2796), or propose three directions:

- **Flow field:** a few hundred to a few thousand lines following a smooth angle field, drawn thin and translucent.
- **Recursive geometry:** subdivided rectangles, circle packing or branching trees.
- **Tiling:** Truchet tiles, hexagons or a rotated grid with a limited palette.
- **Landscape:** layered ridges from summed sine waves or smoothed random values, fading into the distance.

## Build it

Rendering runs without JavaScript, so compute the drawing first and write plain SVG:

- Use PowerShell (always available): `$rng = [System.Random]::new($seed)` gives a reproducible sequence; `$rng.NextDouble()` returns 0 to 1.
- Put every tunable value at the top of the script: `$seed`, `$width`, `$height`, a palette of four or five harmonious colors, density, stroke width, steps.
- Build the shapes as strings in a `System.Text.StringBuilder` (`<path d="M x y L ..."/>`, `<circle .../>`, `<rect .../>`), with coordinates rounded to one decimal to keep the file small.
- For a smooth field without a noise library: `angle = sin(x*a + seed) + cos(y*b - seed) + sin((x+y)*c)`, with small `a`, `b` and `c`.
- Keep it to about 20,000 shapes or path points per image so the script finishes in seconds. Use `-f` formatting with `[cultureinfo]::InvariantCulture` so decimals use a dot on every PC.
- Write `art.svg`, and an `art.html` that holds the SVG inline with `body { margin: 0; background: <color> }`, both UTF-8 with `[IO.File]::WriteAllText`.

## Render and share

- `document_render({ path: "art.html", format: "png", width: <w>, height: <h> })`, then check the image looks right (not blank, not cut off).
- Send the PNG with `attachment_send`, with the seed in the caption. The SVG can be sent too; it stays sharp at any size.
- Offer variations: a new seed, another palette, more or less density. Save each as `art-<seed>.png` so favorites are not overwritten.
