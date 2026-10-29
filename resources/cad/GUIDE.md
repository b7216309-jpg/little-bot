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

Every replicad function is already in scope, and so are the workshop's own helpers below; do not import anything. `main` returns one solid, or several named parts. Keep the part in one piece unless the user asks for several.

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
- Or with patterns, which return the copies as one shape to fuse, cut or return (the first copy stays in place):
  - `linearPattern(shape, count, [dx, dy, dz])`: copies a step apart.
  - `gridPattern(shape, [columns, rows], [dx, dy])`: a grid in X and Y.
  - `polarPattern(shape, count, { angle: 360, axis: [0, 0, 1], center: [0, 0, 0] })`: copies round an axis; a full turn spreads them evenly.
  - `mirrorCopy(shape, "YZ")`: the shape and its mirror image.
  - `fuseAll([a, b, c])`, `cutAll(base, [tool1, tool2])`.

## Rounding, bevelling, hollowing

These take a finder that picks the edges or faces:

- `shape.fillet(radius, (e) => e.inDirection("Z"))` rounds the vertical edges.
- `shape.chamfer(size, (e) => e.inPlane("XY", height))` bevels the top edges.
- `shape.shell(wall, (f) => f.inPlane("XY", height))` hollows the solid, removing the top face; the outer size stays the same.

Edge finder filters: `inDirection("X" | "Y" | "Z")`, `inPlane("XY", z)`, `ofCurveType("LINE" | "CIRCLE")`, `ofLength(l)`, `containsPoint([x, y, z])`, `not((e) => …)`, `either([(e) => …, (e) => …])`. Face finder: `inPlane("XY", z)`, `parallelTo("XY")`, `ofSurfaceType("PLANE" | "CYLINDRE")`, `containsPoint([x, y, z])`. Filters chain: `(e) => e.inDirection("Z").containsPoint([20, 10, 2])`.

A fillet or chamfer fails when it is larger than the faces beside the edge allow: use a smaller radius or fewer edges. Fillet before cutting small holes; it is more robust.

When the user points at a face or edge, its details include a ready finder, for example `(e) => e.containsPoint([12, -5, 4])`. Use it to round or bevel exactly that edge.

## Threads and fasteners

ISO metric sizes M2 to M20 by name (`"M3"`), or any diameter with `{ pitch }`. Every helper works along Z at the origin; move the result with `translate` and `rotate`.

- `thread("M8", 20)`: a threaded rod from z = 0 to 20, with a 45° lead-in at both ends (`{ chamfer: false }` for none, `{ leftHand: true }`).
- `bolt("M5", 16, { head: "socket" | "hex" | "button" | "countersunk", threaded: true })`: head on top of z = 0, shank down to z = -16. A countersunk head sits below z = 0, flush with the surface.
- `nut("M5", { threaded: false })` from z = 0 up; `washer("M5")`.

Holes are cutting tools that go down from z = 0 and poke 0.5 mm above it, so place them at the surface they start from: `part.cut(boltHole("M4", 10).translate([x, y, top]))`.

- `boltHole(size, depth, { head: "socket" | "button" | "hex" | "countersunk" | "none", fit: "close" | "normal" | "loose", headDepth })`: ISO clearance hole with a counterbore or countersink for the head.
- `threadedHole(size, depth)`: a modelled internal thread. `tapHole(size, depth)`: the tap-drill size, to tap later or for a screw to cut its own thread in plastic.
- `nutTrap(size, { depth, slot })`: a hexagonal pocket; `slot` opens it sideways along +X to slide the nut in.
- `insertHole(size, { depth })`: a hole for a heat-set insert (typical sizes; the user's inserts may differ).

These helpers make the shapes at their nominal sizes. Every one takes `{ clearance }` in mm on the diameter if the user wants room for printing; nothing is added unless you add it. Threads take a few seconds each: prefer `tapHole` or `boltHole` unless the thread itself matters (a printed screw, a threaded cap). Threads under M3 print poorly.

## Text

`text("Hello", { size: 10, height: 1, font: "Arial", bold: false, italic: false, align: "left" | "center" | "right", valign: "baseline" | "center" | "top" | "bottom" })` lies on XY from z = 0 up. Emboss with `fuse`, engrave with `cut` after moving it down into the surface. Any font installed on this PC works; write its name as plain text in the script (`font: "Segoe UI"`).

## Imported parts

`importPart("bracket.step")` (or `.stp`, `.stl`) reads a file from the working folder's cad folder, or the working folder itself, as a shape to build on, cut from or use as a reference part. Write the file name as plain text. STL files are meshes: fine to look at and combine, but their many small faces cannot be filleted.

## Several parts and assemblies

Things printed or bought as separate pieces (a box and its lid, a hinge and its pin, the screws) are separate parts, up to 200. Return them named, placed where they go when assembled:

- `return { box, lid };` names each part by its key, or `return [{ name: "box", shape: box }, { name: "lid", shape: lid, color: "#a9c4dd" }];`.
- An entry may also say `material` (PLA, PETG, ABS, ASA, TPU, Nylon, PC, Resin, Aluminium, Steel, Stainless, Brass, Copper, Wood, Plywood, MDF, Acrylic, Rubber) for its weight, `count` (how many are needed), and `bought: true` for hardware such as screws: bought parts are in the bill of materials and the STEP assembly, not in the print files.
- Joints: `joint: hinge({ axis: [1, 0, 0], origin: [0, 20, 30], min: 0, max: 110 })` turns a part (degrees) around an axis through a point; `slider({ axis: [1, 0, 0], min: 0, max: 40 })` moves it (mm); `value` sets where it rests. `parent: "box"` makes it move with another part; `joint: attach("lid")` only fixes it to that part (a handle on a lid). Joints are written in the assembled positions.
- Each part is checked on its own: one loose piece inside a part is still an error, but two parts are not. Parts that overlap are an error; gaps are not judged, so leave the room the user asked for. Each joint is swept through its range: a part that runs into another on the way is reported with where it happens.
- `bom` lists parts, counts, materials and weights. `pose` with `{"lid": 90}` shows the assembly with joints moved and says what runs into what; `view` takes `pose` and `explode` (0 to 1) too.
- Exports of all parts lay the printed ones side by side (STEP keeps everything assembled, with names); `export` with `part` gives one.
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

A box with a hinged lid on a pin, screwed to a base plate, with the hardware in the bill of materials:

```js
const params = { width: 50, depth: 30, height: 20, wall: 3 };

function main(p) {
  const box = makeBaseBox(p.width, p.depth, p.height).shell(p.wall, (f) => f.inPlane("XY", p.height))
    .cut(boltHole("M3", p.wall, { head: "countersunk" }).translate([0, 0, p.wall]));
  const lid = makeBox([-p.width / 2, -p.depth / 2, p.height], [p.width / 2, p.depth / 2, p.height + p.wall]);
  const screw = bolt("M3", 8, { head: "countersunk" }).translate([0, 0, p.wall]);
  return {
    box: { shape: box, material: "PETG" },
    lid: { shape: lid, material: "PETG", joint: hinge({ axis: [-1, 0, 0], origin: [0, p.depth / 2, p.height + p.wall], min: 0, max: 120 }) },
    screw: { shape: screw, material: "Steel", bought: true },
  };
}
```
