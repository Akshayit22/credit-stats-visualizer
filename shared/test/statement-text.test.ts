import { describe, expect, it } from 'vitest';
import { itemsToLines } from '../src/pdf-layout.js';
import {
  formatStatementText,
  normaliseStatementText,
  parseStatementText,
  toLines,
} from '../src/statement-text.js';

describe('the canonical statement text', () => {
  it('round-trips pages through the @@PAGE markers', () => {
    const text = formatStatementText([
      { pageNumber: 1, lines: ['A\tB', 'C'] },
      { pageNumber: 2, lines: ['D'] },
    ]);
    expect(text).toBe('@@PAGE 1\nA\tB\nC\n@@PAGE 2\nD');
    expect(parseStatementText(text)).toEqual([
      { pageNumber: 1, lines: ['A\tB', 'C'] },
      { pageNumber: 2, lines: ['D'] },
    ]);
  });

  it('splits each line into its cells', () => {
    const [line] = toLines('@@PAGE 1\n01 Aug 26\tInterest\t₹39.69');
    expect(line?.cells).toEqual(['01 Aug 26', 'Interest', '₹39.69']);
    expect(line?.text).toBe('01 Aug 26 Interest ₹39.69');
  });

  it('normalises invisible characters and curly punctuation but keeps the tabs', () => {
    const out = normaliseStatementText('idfc​first  bank\t‘x’ – y\t\t\r\n\n');
    expect(out).toBe("idfcfirst bank\t'x' - y");
  });
});

describe('itemsToLines', () => {
  it('groups by row, orders by x, and marks column gaps with a tab', () => {
    const lines = itemsToLines([
      { str: 'Amount', x: 200, y: 700, width: 40 },
      { str: 'Date', x: 10, y: 700.5, width: 20 },
      { str: 'next', x: 10, y: 680, width: 20 },
      { str: ' ', x: 40, y: 680, width: 2 },
    ]);
    expect(lines).toEqual(['Date\tAmount', 'next']);
  });

  it('joins words in the same column without a tab', () => {
    const lines = itemsToLines([
      { str: 'SWIG', x: 10, y: 500, width: 20 },
      { str: 'GY', x: 31, y: 500, width: 10 },
    ]);
    expect(lines).toEqual(['SWIGGY']);
  });
});
