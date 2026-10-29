// The joints of an assembly, shared by the engine (collision checks) and the 3D view (posing and exploding).
// A joint belongs to the part that moves; a hinge turns it around an axis through a point, a slider moves it along
// an axis, and a fixed joint only attaches it. Parts attached to a moving part (parent) move with it. Joints are
// written in the assembled positions, so a pose applies a part's own joint first, then its parent's, and so on.

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const unit = axis => { const length = Math.hypot(...axis) || 1; return axis.map(value => value / length); };

// Checks the joints that parts declared and returns them by part index, or throws with a message for the script.
export function normalizeJoints(parts) {
  const names = parts.map(part => part.name);
  const joints = parts.map(part => {
    const joint = part.joint;
    if (!joint) return null;
    if (typeof joint !== 'object' || !['hinge', 'slider', 'fixed'].includes(joint.type)) throw new Error(`Part "${part.name}": joint must come from hinge(), slider() or attach().`);
    const label = `Part "${part.name}"`;
    const axis = joint.axis.map(Number);
    if (joint.type !== 'fixed' && !(Math.hypot(...axis) > 1e-9)) throw new Error(`${label}: the joint axis cannot be [0, 0, 0].`);
    const min = Number(joint.min), max = Number(joint.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error(`${label}: the joint needs min ≤ max.`);
    const value = Math.min(max, Math.max(min, Number.isFinite(Number(joint.value)) ? Number(joint.value) : 0));
    let parent = null;
    if (joint.parent !== null && joint.parent !== undefined) {
      parent = names.indexOf(String(joint.parent));
      if (parent < 0) throw new Error(`${label}: there is no part "${String(joint.parent).slice(0, 40)}" to attach to. Parts: ${names.join(', ')}.`);
      if (parent === names.indexOf(part.name)) throw new Error(`${label} cannot be attached to itself.`);
    }
    return { type: joint.type, axis: unit(axis), origin: joint.origin.map(Number), min, max, value, parent };
  });
  // No loops: following parents from any part must end.
  joints.forEach((joint, index) => {
    const seen = new Set([index]);
    for (let at = joint?.parent; at !== null && at !== undefined; at = joints[at]?.parent) {
      if (seen.has(at)) throw new Error(`Parts "${parts[index].name}" and "${parts[at].name}" are attached to each other in a loop.`);
      seen.add(at);
    }
  });
  return joints;
}

// The moves that place a part for a pose ({ part name: value }), own joint first.
export function movesOf(parts, joints, index, pose = {}) {
  const moves = [];
  for (let at = index; at !== null && at !== undefined; at = joints[at]?.parent) {
    const joint = joints[at];
    if (!joint) break;
    if (joint.type !== 'fixed') {
      const asked = Number(pose?.[parts[at].name]);
      const value = Math.min(joint.max, Math.max(joint.min, Number.isFinite(asked) ? asked : joint.value));
      if (value) moves.push({ type: joint.type, axis: joint.axis, origin: joint.origin, value });
    }
  }
  return moves;
}

// Column-major 4×4 matrices, as three.js reads them.
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function moveMatrix(move) {
  if (move.type === 'slider') { const [x, y, z] = move.axis.map(value => value * move.value); return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
  const [x, y, z] = move.axis, angle = move.value * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const rotation = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
  const [ox, oy, oz] = move.origin;
  return multiply([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, oz, 1], multiply(rotation, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -ox, -oy, -oz, 1]));
}
// A point through a column-major matrix (null: unmoved), and back through a rigid one.
export function applyMatrix(m, [x, y, z], w = 1) {
  if (!m) return [x, y, z];
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
}
export function unapplyMatrix(m, [x, y, z]) {
  if (!m) return [x, y, z];
  const [a, b, c] = [x - m[12], y - m[13], z - m[14]];
  return [m[0] * a + m[1] * b + m[2] * c, m[4] * a + m[5] * b + m[6] * c, m[8] * a + m[9] * b + m[10] * c];
}

export function matrixOf(moves) { return moves.reduce((matrix, move) => multiply(moveMatrix(move), matrix), IDENTITY); }
export const identity = () => IDENTITY.slice();
export function translation([x, y, z]) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
export function compose(first, second) { return multiply(second, first); }

// Exploded view: each part pushed away from the middle of the assembly along the line from there to its own
// middle, by up to its distance again (amount 0..1).
export function explodeOffsets(boxes, amount) {
  if (!(amount > 0) || boxes.length < 2) return boxes.map(() => [0, 0, 0]);
  const middle = box => [0, 1, 2].map(axis => (box[0][axis] + box[1][axis]) / 2);
  const centers = boxes.map(middle);
  const all = [0, 1, 2].map(axis => (Math.min(...boxes.map(box => box[0][axis])) + Math.max(...boxes.map(box => box[1][axis]))) / 2);
  const size = Math.max(...[0, 1, 2].map(axis => Math.max(...boxes.map(box => box[1][axis])) - Math.min(...boxes.map(box => box[0][axis])))) || 1;
  return centers.map(center => {
    const away = center.map((value, axis) => value - all[axis]);
    const length = Math.hypot(...away);
    // A part in the very middle rises instead.
    const direction = length > size * 0.02 ? away.map(value => value / length) : [0, 0, 1];
    const push = (length > size * 0.02 ? length : size * 0.5) * amount * 1.2;
    return direction.map(value => value * push);
  });
}
