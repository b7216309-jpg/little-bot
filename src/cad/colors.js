// Colors for the parts of a model that do not choose one; the first is a single part's own color. Shared by the
// engine (exports) and the 3D view.
export const PART_COLORS = ['#d9dccf', '#a9c4dd', '#e3c79f', '#c4b5dc', '#b5d6b5', '#e2b0ae', '#a9d6d3', '#d9c2a5'];

export const partColor = (part, index) => (typeof part?.color === 'string' && /^#[\da-f]{6}$/i.test(part.color) ? part.color : PART_COLORS[index % PART_COLORS.length]);
