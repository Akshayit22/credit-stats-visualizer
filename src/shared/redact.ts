import { CELL, normaliseStatementText } from './statement-text';

/**
 * Redaction, in two passes.
 *
 * `redactForStorage` runs in the browser before anything is posted, and again
 * on the server before anything is parsed. It removes what we have no reason to
 * hold: the holder's name and address, phone, email, customer id, nominee,
 * IFSC/MICR, and the full card or account number (the last four survive — that
 * is how an account is recognised across months).
 *
 * `redactForLlm` runs only when a prompt is being built. It additionally strips
 * long digit runs — UPI and IMPS reference ids — which a model has no use for
 * and which are the last identifying thing left in a description.
 *
 * Merchant and counterparty text survives both passes: categorisation needs it,
 * and it is the point of the product. The one exception is the holder's own
 * name, which becomes `SELF` — it is PII, and `SELF` is more useful than the
 * name anyway, because it marks a self-transfer.
 */

export interface RedactionResult {
  text: string;
  /** What was removed, by kind, for the review step's "we removed N things". */
  counts: Record<string, number>;
}

export const MASK = {
  email: '[email]',
  phone: '[phone]',
  customerId: '[customer-id]',
  address: '[address]',
  name: '[name]',
  ifsc: '[ifsc]',
  micr: '[micr]',
  self: 'SELF',
  reference: '[ref]',
  vpa: '[vpa]',
} as const;

/* ── patterns ────────────────────────────────────────────────────────────── */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * A UPI virtual payment address — `akshaytelang395@oksbi`, `q023830599@ybl`.
 * Email-shaped but with no dot in the handle part, so the email pattern misses
 * it, and it routinely carries the holder's own name spelled without spaces.
 * The merchant or counterparty always sits in its own segment of the
 * description, so masking the handle costs categorisation nothing.
 */
const VPA = /\b[A-Za-z0-9._%+-]{2,}@[A-Za-z][A-Za-z0-9]{1,20}\b/g;
/** An Indian mobile number, with or without the country code. */
const PHONE = /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g;
/** `SBIN0010486`, `NESF0SLCUPI`, `UTIB0000004` — four letters, a zero, six more. */
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
/** `652984******9581`, `XXXXXXXX9652`. */
const MASKED_PAN = /\b[0-9X]{4,8}[*X]{4,8}(\d{4})\b/g;
/** A bare Indian PIN code standing alone in a cell. */
const PIN_CODE = /^\d{6}$/;

const ADDRESS_WORDS =
  /\b(?:FLAT|FLATS|FLOOR|STREET|ROAD|NAGAR|COLONY|SECTOR|PLOT|HOUSE|APARTMENT|LANE|CROSS|NEAR|OPP|BEHIND|VILLAGE|TALUKA|DISTRICT|TOWER|SOCIETY|MARG)\b/i;
/** A cell that ends in an Indian PIN code, e.g. `CHENNAI 600026`. */
const ENDS_IN_PIN = /(?:^|\s)\d{6}$/;

/**
 * Labelled header fields, as the canonical text prints them:
 * `Customer ID<TAB>380009067496`. The label is kept so the parsers can still
 * find the row; only the value is replaced.
 */
const LABELLED: ReadonlyArray<{ label: RegExp; mask: string; keepLast4?: boolean }> = [
  { label: /^customer\s*id$/i, mask: MASK.customerId },
  { label: /^(?:phone|mobile)$/i, mask: MASK.phone },
  { label: /^e-?mail$/i, mask: MASK.email },
  { label: /^nominee$/i, mask: MASK.name },
  { label: /^address$/i, mask: MASK.address },
  { label: /^micr$/i, mask: MASK.micr },
  { label: /^(?:alternate\s+)?ifsc$/i, mask: MASK.ifsc },
  { label: /^a\/c\s*number$/i, mask: '', keepLast4: true },
  { label: /^account\s*(?:number|no\.?:?)$/i, mask: '', keepLast4: true },
  { label: /^(?:credit\s*)?card\s*(?:number|no\.?:?)$/i, mask: '', keepLast4: true },
];

/**
 * The header zone is everything before the transaction table starts — that is
 * where addresses and identity fields live, and it is the only place the
 * address sweep is allowed to run, so a merchant called "Station Road Stores"
 * is never mistaken for a postal address.
 */
const HEADER_ZONE_MAX_LINES = 28;
const TABLE_HEADER =
  /^\s*DATE\b.*\b(?:DETAILS|PARTICULARS|NARRATION|DESCRIPTION|TRANSACTION)\b/i;

export function headerZoneEnd(lines: string[]): number {
  const limit = Math.min(lines.length, HEADER_ZONE_MAX_LINES);
  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (line !== undefined && TABLE_HEADER.test(line.replace(/\t/g, ' '))) return i;
  }
  return limit;
}

/* ── holder-name detection ───────────────────────────────────────────────── */

const NOT_A_NAME =
  /\b(?:BANK|CARD|CREDIT|DEBIT|STATEMENT|SUMMARY|ACCOUNT|LIMIT|PAYMENT|DETAILS|DETAIL|BALANCE|TOTAL|DATE|BRANCH|SAVING|SAVINGS|RUPAY|VISA|MASTERCARD|AXIS|SLICE|HDFC|ICICI|SBI|KOTAK|MESSAGE|IMPORTANT|CONTACT|SCHEDULE|CHARGES|INTEREST|CASHBACK|END|TRANSACTION|PERIOD|DUE|OPENING|CLOSING)\b/i;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bank PDFs truncate names to fit a column: `AKSHAY LALUMAN TELANG` prints as
 * `AKSHAY LALUMAN TELAN` inside one UPI description and as `Mr. Akshay Laluman T`
 * in another. So: every character after the first is optional, nested, which
 * matches any non-empty prefix and nothing longer.
 */
function truncatablePrefix(word: string): string {
  const chars = [...word].map(escapeRegex);
  const first = chars[0];
  if (first === undefined) return '';
  let tail = '';
  for (let i = chars.length - 1; i >= 1; i -= 1) {
    tail = `(?:${chars[i]}${tail})?`;
  }
  return `${first}${tail}`;
}

export function holderNamePattern(fullName: string): RegExp | null {
  const tokens = fullName
    .replace(/[^A-Za-z\s.]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/\./g, ''))
    .filter((token) => token.length >= 2 && !/^(?:mr|mrs|ms|shri|smt|dr)$/i.test(token));

  const first = tokens[0];
  if (first === undefined) return null;

  let inner = '';
  for (let i = tokens.length - 1; i >= 1; i -= 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    // The separator is optional: a UPI handle runs the tokens together
    // (`akshaytelang395@oksbi`), and matching there is the whole point.
    inner = `(?:[\\s.-]*${truncatablePrefix(token)}${inner})?`;
  }

  const honorific = '(?:(?:MR|MRS|MS|SHRI|SMT|DR)\\.?[\\s]+)?';
  return new RegExp(`${honorific}${escapeRegex(first)}${inner}`, 'gi');
}

function isNameLike(value: string): boolean {
  if (value.length < 6 || value.length > 60) return false;
  if (/\d/.test(value)) return false;
  if (NOT_A_NAME.test(value)) return false;
  if (!/^[A-Za-z][A-Za-z\s.'-]+$/.test(value)) return false;
  return value.trim().split(/\s+/).length >= 2;
}

/**
 * The account holder's name, from the two places statements print it: a
 * labelled `Name` row anywhere in the header, and the first bare all-caps line
 * near the top. Only the *first* bare line is taken — later all-caps headings
 * ("IMPORTANT MESSAGE") would otherwise be mistaken for names.
 */
export function detectHolderNames(text: string): string[] {
  const found = new Set<string>();
  const lines = text.split('\n');
  let tookBareLine = false;

  lines.slice(0, HEADER_ZONE_MAX_LINES).forEach((rawLine) => {
    const cells = rawLine.split(CELL).map((cell) => cell.trim());

    for (let i = 0; i < cells.length - 1; i += 1) {
      const label = cells[i];
      const value = cells[i + 1];
      if (label === undefined || value === undefined) continue;
      if (/^(?:name|account\s*holder|customer\s*name)$/i.test(label) && isNameLike(value)) {
        found.add(value);
      }
    }

    if (tookBareLine) return;
    const filled = cells.filter((cell) => cell.length > 0);
    const single = filled.length === 1 ? filled[0] : undefined;
    if (single !== undefined && /^[A-Z][A-Z\s.]{5,48}$/.test(single) && isNameLike(single)) {
      found.add(single);
      tookBareLine = true;
    }
  });

  return [...found];
}

/* ── the passes ──────────────────────────────────────────────────────────── */

export function redactForStorage(rawText: string): RedactionResult {
  const counts: Record<string, number> = {};
  const bump = (kind: string) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  };

  const normalised = normaliseStatementText(rawText);
  const holderPatterns = detectHolderNames(normalised)
    .map(holderNamePattern)
    .filter((pattern): pattern is RegExp => pattern !== null);

  const lines = normalised.split('\n');
  const zoneEnd = headerZoneEnd(lines);
  /** True when the previous line carried a labelled `Address` row. */
  let addressContinues = false;

  const redacted = lines.map((line, lineIndex) => {
    const cells = line.split(CELL);
    const inHeaderZone = lineIndex < zoneEnd;

    // 1. Labelled header fields — replace the value, keep the label.
    let labelledAddressHere = false;
    for (let i = 0; i < cells.length - 1; i += 1) {
      const label = (cells[i] ?? '').trim();
      const rule = LABELLED.find((candidate) => candidate.label.test(label));
      if (!rule) continue;
      const value = (cells[i + 1] ?? '').trim();
      if (value.length === 0) continue;
      if (rule.keepLast4) {
        const digits = value.replace(/\D/g, '');
        if (digits.length >= 4) {
          cells[i + 1] = `XXXX${digits.slice(-4)}`;
          bump('accountNumber');
        }
      } else {
        cells[i + 1] = rule.mask;
        bump(labelKind(label));
        if (rule.mask === MASK.address) labelledAddressHere = true;
      }
    }

    // 2. The address sweep. Postal addresses wrap over several lines and only
    //    the first carries a label — on the card statement none of them does.
    //    Inside the header zone, any cell that reads like an address fragment
    //    goes, and the block stays open until a line stops looking like one.
    if (inHeaderZone) {
      for (let i = 0; i < cells.length; i += 1) {
        const cell = (cells[i] ?? '').trim();
        if (cell.length === 0 || cell === MASK.address) continue;
        // An address fragment always carries a number or a comma. Requiring one
        // keeps headings like "PAYMENT SUMMARY" and "Total Payment Due" — which
        // the parsers need — out of the sweep.
        const hasAddressShape = /[\d,]/.test(cell);
        const looksLikeAddress =
          PIN_CODE.test(cell) ||
          (hasAddressShape && (ENDS_IN_PIN.test(cell) || ADDRESS_WORDS.test(cell))) ||
          (addressContinues && i === 0 && hasAddressShape && !isLabelCell(cell));
        if (looksLikeAddress) {
          cells[i] = MASK.address;
          bump('address');
        }
      }
      addressContinues = labelledAddressHere;
    } else {
      addressContinues = false;
    }

    // 3. Free-text patterns, anywhere on the line.
    let joined = cells.join(CELL);
    joined = replaceCounting(
      joined,
      MASKED_PAN,
      (_match, last4) => `XXXX${last4}`,
      () => bump('accountNumber'),
    );
    joined = replaceCounting(joined, EMAIL, () => MASK.email, () => bump('email'));
    // Order matters here.
    //  - IFSC before VPA: a VPA's local part may contain hyphens
    //    (`gpay-12201811742@okbizaxis`), so without the IFSC already replaced
    //    the handle pattern runs left across `A-SBIN0004636-` and swallows a
    //    counterparty name's last letter along with it.
    //  - VPA before PHONE: many handles are `<mobile>@<bank>`, and masking the
    //    number first leaves the handle half-redacted.
    joined = replaceCounting(joined, IFSC, () => MASK.ifsc, () => bump('ifsc'));
    joined = replaceCounting(joined, VPA, () => MASK.vpa, () => bump('upiHandle'));
    joined = replaceCounting(joined, PHONE, () => MASK.phone, () => bump('phone'));

    // 4. The holder's own name, wherever it appears, truncated or not.
    for (const pattern of holderPatterns) {
      joined = replaceCounting(joined, pattern, () => MASK.self, () => bump('holderName'));
    }

    return joined;
  });

  return { text: normaliseStatementText(redacted.join('\n')), counts };
}

/**
 * Every mask token this module can emit, as a pattern that matches one at the
 * end of a string. A statement that hard-wraps a field mid-word leaves a
 * truncated value on one line and its tail on the next; redaction runs per
 * line, so it masks the head and cannot see the tail. A parser joining the two
 * uses this to recognise the seam.
 */
export const MASK_AT_END = /(?:SELF|\[[a-z-]+\])$/;

/**
 * Joins a wrapped continuation onto the line above it.
 *
 * slice hard-wraps mid-word, so the join takes no separator: `…TE` + `LAN` is
 * `…TELAN`. When the head ends in a mask, the continuation's leading word run
 * is the rest of the value that was masked, and goes with it.
 */
export function joinWrappedDetail(head: string, tail: string): string {
  if (MASK_AT_END.test(head)) return head + tail.replace(/^[A-Za-z0-9.@_]+/, '');
  return head + tail;
}

/**
 * Re-applies the free-text masks to a string assembled from several lines.
 * An identifier split across a wrap is invisible to the per-line pass and only
 * becomes recognisable once the parser has joined the pieces.
 */
export function redactFreeText(text: string): string {
  let out = text;
  out = out.replace(MASKED_PAN, (_match, last4: string) => `XXXX${last4}`);
  out = out.replace(EMAIL, MASK.email);
  out = out.replace(IFSC, MASK.ifsc);
  out = out.replace(VPA, MASK.vpa);
  out = out.replace(PHONE, MASK.phone);
  return out;
}

/**
 * The extra pass a prompt gets. Long digit runs — UPI/IMPS reference ids — are
 * the only identifying thing left in a description once storage redaction has
 * run, and a model has no use for them.
 */
export function redactForLlm(storedText: string): string {
  return storedText
    .split('\n')
    .map((line) => line.replace(/\b\d{9,}\b/g, MASK.reference))
    .join('\n');
}

export interface PiiLeak {
  kind: string;
  sample: string;
}

/**
 * Asserts a text carries none of the identifiers we promise never to keep.
 * The fixture builder refuses to write a file that fails this, and
 * `tests/privacy.test.ts` re-checks the committed fixtures, so a hole in the
 * rules fails the build rather than shipping.
 */
export function findPiiLeaks(
  text: string,
  /**
   * `statement` also checks the header zone for an unmasked account or card
   * number. `fragment` is for a single description or merchant name, where a
   * long digit run is a transaction reference we keep on purpose.
   */
  scope: 'statement' | 'fragment' = 'statement',
): PiiLeak[] {
  const leaks: PiiLeak[] = [];
  const check = (kind: string, pattern: RegExp) => {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) leaks.push({ kind, sample: maskSample(match[0]) });
  };
  check('email address', EMAIL);
  check('UPI handle', VPA);
  check('phone number', PHONE);
  check('IFSC code', IFSC);

  // A long digit run below the transaction table is a transaction reference —
  // we store those on purpose. One in the header zone would be an account or
  // card number that got past the rules. Twelve digits is the floor: shorter
  // runs up there are helpline numbers ("Auto-Debit facility on 18605005555").
  if (scope === 'statement') {
    const lines = text.split('\n');
    const header = lines.slice(0, headerZoneEnd(lines)).join('\n');
    const account = /\b\d{12,19}\b/g;
    const match = account.exec(header);
    if (match) leaks.push({ kind: 'account or card number', sample: maskSample(match[0]) });
  }

  return leaks;
}

/** Enough to locate the leak in a fixture, not enough to be the leak again. */
function maskSample(value: string): string {
  if (value.length <= 4) return value;
  return `${value.slice(0, 2)}…${value.slice(-2)} (${value.length} chars)`;
}

function isLabelCell(cell: string): boolean {
  return /^(?:customer\s*id|phone|email|nominee|address|micr|ifsc|branch|account|a\/c\s*number|account\s*opening|date|alternate\s*ifsc)$/i.test(
    cell.trim(),
  );
}

function replaceCounting(
  text: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
  onMatch: () => void,
): string {
  pattern.lastIndex = 0;
  return text.replace(pattern, (match, ...args) => {
    onMatch();
    const groups = args.filter((arg): arg is string => typeof arg === 'string');
    return replacer(match, ...groups);
  });
}

function labelKind(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('email')) return 'email';
  if (lower.includes('phone') || lower.includes('mobile')) return 'phone';
  if (lower.includes('customer')) return 'customerId';
  if (lower.includes('nominee')) return 'nominee';
  if (lower.includes('address')) return 'address';
  if (lower.includes('micr')) return 'micr';
  if (lower.includes('ifsc')) return 'ifsc';
  return 'other';
}
