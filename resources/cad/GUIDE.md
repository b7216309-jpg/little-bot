# CAD workshop guide

Parts are scripts for replicad (OpenCascade). Units are millimetres, Z points up, the bed is z = 0.

## Script shape

```js
// Numbers in params become sliders; true/false become switches.
const params = { width: 40, depth: 25, thickness: 4, hole: { value: 4.5, min: 2, max: 10, step: 0.5 } };

function main(p) {
  // p holds the current values (the user may have moved a slider).
  return makeBaseBox(p.width, p.depth, p.thickness);
}
```

Every replicad function is already in scope; do not import anything. `main` returns one solid (or a list of solids). Keep the part in one piece unless the user asks for several.

## Making solids

- `makeBaseBox(x, y, z)`: a box centred on the origin in X and Y, from z = 0 to z.
- `makeBox([x1, y1, z1], [x2, y2, z2])`: a box between two corners.
- `makeCylinder(radius, height, [x, y, z] = origin, [dx, dy, dz] = up)`: a cylinder from its base point along a direction.
- `makeSphere(radius)`.
- 2D first, then a solid: `drawRectangle(w, h)`, `drawRoundedRectangle(w, h, r)`, `drawCircle(r)`, `drawPolysides(r, sides)`, or a pen: `draw([x, y]).hLine(dx).vLine(dy).line(dx, dy).lineTo([x, y]).hLineTo(x).vLineTo(y).close()`. Drawings combine with `.fuse(other)`, `.cut(other)`, `.translate(dx, dy)`, `.rotate(degrees, [cx, cy])`, `.fillet(r)` (rounds every corner of the 2D outline).
- `drawing.sketchOnPlane("XY", z)` then `.extrude(height)`. Other planes: `"XZ"`, `"YZ"`.
- `drawing.sketchOnPlane("XZ").revolve()`: spins the profile around the Z axis. Draw the profile with x ≥ 0.

## Combining and moving

- `a.fuse(b)`, `a.cut(b)`, `a.intersect(b)`. Holes are cylinders cut away; make the tool longer than the part so it cuts through cleanly.
- `shape.translate([dx, dy, dz])`, `shape.rotate(degrees, [x, y, z], [dx, dy, dz])` (around an axis through the point), `shape.mirror("YZ")`.
- Repeat with ordinary loops: `for (const x of [-15, 15]) part = part.cut(makeCylinder(2, 20, [x, 0, -5]));`

## Rounding, bevelling, hollowing

These take a finder that picks the edges or faces:

- `shape.fillet(radius, (e) => e.inDirection("Z"))` rounds the vertical edges.
- `shape.chamfer(size, (e) => e.inPlane("XY", height))` bevels the top edges.
- `shape.shell(wall, (f) => f.inPlane("XY", height))` hollows the solid, removing the top face; the outer size stays the same.

Edge finder filters: `inDirection("X" | "Y" | "Z")`, `inPlane("XY", z)`, `ofCurveType("LINE" | "CIRCLE")`, `ofLength(l)`, `containsPoint([x, y, z])`, `not((e) => …)`, `either([(e) => …, (e) => …])`. Face finder: `inPlane("XY", z)`, `parallelTo("XY")`, `ofSurfaceType("PLANE" | "CYLINDRE")`, `containsPoint([x, y, z])`. Filters chain: `(e) => e.inDirection("Z").containsPoint([20, 10, 2])`.

A fillet or chamfer fails when it is larger than the faces beside the edge allow: use a smaller radius or fewer edges. Fillet before cutting small holes; it is more robust.

When the user points at a face or edge, its details include a ready finder, for example `(e) => e.containsPoint([12, -5, 4])`. Use it to round or bevel exactly that edge.

## Several parts

Things printed as separate pieces (a box and its lid, a hinge and its pin) are separate parts. Return them named, placed where they go when assembled:

- `return { box, lid };` names each part by its key, or `return [{ name: "box", shape: box }, { name: "lid", shape: lid, color: "#a9c4dd" }];` with an optional color.
- Each part is checked on its own: one loose piece inside a part is still an error, but two parts are not.
- The fit between parts is checked: an overlap is an error; a gap under the minimum clearance (0.2 mm by default) is too tight to print; parts that touch are noted. Parts that slide or snap together need 0.2–0.3 mm of clearance on each side.
- Exports of all parts lay them side by side for printing (STEP keeps them assembled, with names); `export` with `part` gives one.
- Model each part the way up it should print when you can; otherwise mention which part to flip in the slicer.

## Examples

A plate with four holes and rounded corners:

```js
const params = { width: 60, depth: 40, thickness: 4, hole: 4.5, margin: 6 };

function main(p) {
  let outline = drawRoundedRectangle(p.width, p.depth, 4);
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    outline = outline.cut(drawCircle(p.hole / 2).translate(x * (p.width / 2 - p.margin), y * (p.depth / 2 - p.margin)));
  }
  return outline.sketchOnPlane("XY").extrude(p.thickness);
}
```

An open box with rounded corners:

```js
const params = { width: 50, depth: 35, height: 25, wall: 2 };

function main(p) {
  const block = makeBaseBox(p.width, p.depth, p.height).fillet(4, (e) => e.inDirection("Z"));
  return block.shell(p.wall, (f) => f.inPlane("XY", p.height));
}
```

An L bracket with a rounded inner corner and two screw holes:

```js
const params = { length: 40, width: 30, height: 30, thickness: 4, hole: 5 };

function main(p) {
  const base = makeBox([0, 0, 0], [p.length, p.width, p.thickness]);
  const wall = makeBox([0, 0, 0], [p.thickness, p.width, p.height]);
  let bracket = base.fuse(wall).fillet(3, (e) => e.containsPoint([p.thickness, p.width / 2, p.thickness]));
  bracket = bracket.cut(makeCylinder(p.hole / 2, p.thickness * 3, [p.length - 10, p.width / 2, -p.thickness]));
  bracket = bracket.cut(makeCylinder(p.hole / 2, p.thickness * 3, [-p.thickness, p.width / 2, p.height - 10], [1, 0, 0]));
  return bracket;
}
```

A knob made by revolving a profile, with a hole for the shaft:

```js
const params = { radius: 15, height: 12, shaft: 6 };

function main(p) {
  const profile = draw([0, 0]).hLine(p.radius).vLine(p.height * 0.7).lineTo([p.radius * 0.7, p.height]).hLineTo(0).close();
  const knob = profile.sketchOnPlane("XZ").revolve();
  return knob.cut(makeCylinder(p.shaft / 2, p.height * 0.8, [0, 0, -1]));
}
```

A spacer with a chamfered top edge:

```js
const params = { outer: 12, inner: 5.2, height: 8 };

function main(p) {
  const ring = drawCircle(p.outer / 2).cut(drawCircle(p.inner / 2)).sketchOnPlane("XY").extrude(p.height);
  return ring.chamfer(0.8, (e) => e.inPlane("XY", p.height));
}
```

A box with a lid that sits on it, as two parts; the lid's lip fits inside with a gap all round:

```js
const params = { width: 60, depth: 40, height: 30, wall: 2, lid: 4, gap: 0.25 };

function main(p) {
  const box = makeBaseBox(p.width, p.depth, p.height)
    .fillet(3, (e) => e.inDirection("Z"))
    .shell(p.wall, (f) => f.inPlane("XY", p.height));
  const plate = makeBaseBox(p.width, p.depth, p.lid / 2).fillet(3, (e) => e.inDirection("Z"));
  // The lip follows the box's inner wall, one gap inside it (the inner corners have a radius of 3 - wall).
  const lip = makeBaseBox(p.width - 2 * (p.wall + p.gap), p.depth - 2 * (p.wall + p.gap), p.lid / 2)
    .fillet(3 - p.wall - p.gap, (e) => e.inDirection("Z"))
    .translate([0, 0, -p.lid / 2]);
  const lid = plate.fuse(lip).translate([0, 0, p.height]);
  return { box, lid };
}
```

## Not available

Text needs a font file and threads need a helix sweep; neither is set up. Model a thread as a plain hole of the tap-drill size, and engrave text after printing or with a separate tool.
