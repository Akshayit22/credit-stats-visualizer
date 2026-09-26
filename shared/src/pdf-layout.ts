/**
 * Rebuilding printed lines from a PDF's positioned text items.
 *
 * pdf.js hands back words with x/y coordinates, not lines. Grouping them by y
 * gives the printed lines, and a horizontal gap wider than a space marks a
 * column boundary, which becomes a TAB. Column structure is what makes the
 * deterministic parsers possible, so this is shared: the browser runs it on
 * upload and the fixture builder runs the exact same algorithm on the samples.
 */

/** Two items further apart than this horizontally are in different columns. */
const COLUMN_GAP = 2.5;
/** Two items within this many points vertically are on the same printed line. */
const LINE_TOLERANCE = 2;

export interface TextItemLike {
  str: string;
  x: number;
  y: number;
  width: number;
}

export function itemsToLines(items: TextItemLike[]): string[] {
  const kept = items.filter((item) => item.str.trim().length > 0);

  const rows: Array<{ y: number; items: TextItemLike[] }> = [];
  for (const item of kept) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= LINE_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  // PDF y grows upwards, so the top of the page has the largest y.
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    const ordered = [...row.items].sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd: number | null = null;
    for (const item of ordered) {
      if (previousEnd !== null && item.x - previousEnd > COLUMN_GAP) text += '\t';
      text += item.str;
      previousEnd = item.x + item.width;
    }
    return text.replace(/[ \t]+$/, '');
  });
}
