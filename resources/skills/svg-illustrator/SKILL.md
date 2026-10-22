---
name: svg-illustrator
description: Draw illustrations, icons, logos, stickers, diagrams and simple scenes as clean SVG vector art, then render them to PNG at any size to send. Use when the user wants a drawing, an icon, a logo idea, an avatar, a card or a simple picture made from shapes.
---
# SVG illustrator

Vector drawings built from shapes: crisp at any size, easy to tweak.

## Brief

Ask for the subject, the style (flat, line art, cute, minimal, retro), colors, background (transparent or solid) and where it will be used (app icon, profile picture, card, sticker). Offer two quick concepts in words when the idea is open.

## Draw

- Write one `art.svg` with a `viewBox` (for example `0 0 512 512`) and no external images or fonts.
- Build from simple shapes (`circle`, `rect`, `ellipse`, `path`, `polygon`) grouped by part (`<g id="head">`). Use a small palette of three to five colors.
- Keep paths smooth and few; prefer curves (`Q`, `C`) for organic shapes.
- Text: only system fonts (Segoe UI, Arial, Georgia), or convert lettering to paths.
- For an icon, check it still reads at 32 pixels: strong silhouette, few details.

## Render and check

- Wrap it for rendering: an `art.html` containing the SVG inline with `body { margin: 0 }`.
- `document_render({ path: "art.html", format: "png", width: 1024, height: 1024 })`, then look at the result and fix anything off (clipped parts, wrong layering, colors).
- Send the PNG and the SVG with `attachment_send`. The SVG stays editable in Inkscape, Figma or a browser.

Offer variations (colors, pose, a simpler version). For logos, make original designs; do not copy existing brands or trademarks.
