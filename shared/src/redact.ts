import { CELL, normaliseStatementText } from './statement-text.js';

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
 * A UPI virtual payment address — `priyanair395@oksbi`, `q023830599@ybl`.
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
/**
 * An account number printed inline with its own label, rather than in the next
 * column: `SAVINGS ACCOUNT DETAILS FOR A/C : 12345678901`.
 *
 * The labelled-field rules read a label in one cell and its value in the next,
 * which is how most banks lay a header out. IDFC puts the whole thing in one
 * cell inside a heading, so nothing matched it and the full number was kept —
 * in the stored text and in a committed fixture. The label is preserved so the
 * parsers can still find the line; only the digits are cut back to the last
 * four, which is all that identifies an account across months.
 */
const INLINE_ACCOUNT_NUMBER = /\b(A\/C|ACCOUNT)\s*(?:NO\.?|NUMBER)?\s*:\s*(\d{6,18})\b/gi;
/**
 * A MICR code printed inline with its label: `MICR: 600036009 IFSC: SCBL0036078`.
 *
 * The same shape as the account number above — label and value in one cell, so
 * the labelled-field rules never see it. The IFSC beside it is caught by its
 * own free-text pattern, which is why only half of that line was masked.
 */
const INLINE_MICR = /\bMICR\s*:?\s*(\d{9})\b/gi;
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
const TABLE_HEADER = /^\s*DATE\b.*\b(?:DETAILS|PARTICULARS|NARRATION|DESCRIPTION|TRANSACTION)\b/i;

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
 * Bank PDFs truncate names to fit a column: `PRIYA RAMACHANDRAN NAIR` prints as
 * `PRIYA RAMACHANDRAN NAI` inside one UPI description and as `Mr. Priya Ramachandran N`
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
    // (`priyanair395@oksbi`), and matching there is the whole point.
    inner = `(?:[\\s.-]*${truncatablePrefix(token)}${inner})?`;
  }

  const honorific = '(?:(?:MR|MRS|MS|SHRI|SMT|DR)\\.?[\\s]+)?';
  return new RegExp(`${honorific}${escapeRegex(first)}${inner}`, 'gi');
}

/**
 * The holder's name split into standalone words, for the wraps the whole-name
 * pattern cannot see.
 *
 * IDFC spreads one description over three printed lines, with the data row in
 * the middle: `…/AKS` / `YA RAMACHANDRAN` / `NAIR/SBIN00`. The per-line pass
 * masks `AKS` and the spill logic joins a continuation to the line above, but
 * neither can reach a fragment stranded in the *middle* line's description
 * cell — so `RAMACHANDRAN` and `NAIR` travelled into the prompt intact.
 *
 * Matching each word on its own catches them wherever they land. The floor of
 * five characters is the safeguard: it keeps a genuine counterparty from being
 * masked because it shares a short run with the holder (a `Ram` would swallow
 * `RAMESH TRADERS`), while every word long enough to actually identify someone
 * is covered. A 3-4 letter remnant left behind next to a `SELF` identifies
 * nobody, which is the trade this floor makes deliberately.
 */
export function holderTokenPatterns(fullName: string): RegExp[] {
  return fullName
    .replace(/[^A-Za-z\s.]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/\./g, ''))
    .filter((token) => token.length >= 5 && !/^(?:mr|mrs|ms|shri|smt|dr)$/i.test(token))
    .map((token) => new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi'));
}

function isNameLike(value: string): boolean {
  if (value.length < 6 || value.length > 60) return false;
  if (/\d/.test(value)) return false;
  if (NOT_A_NAME.test(value)) return false;
  // An address line is shaped exactly like a name — several capitalised words,
  // no digits — and Standard Chartered prints the two in the same column. Taken
  // as the holder it is wrong twice: the address gets masked as a person, and
  // the real name, having no candidate left, is not masked at all.
  if (ADDRESS_WORDS.test(value)) return false;
  if (!/^[A-Za-z][A-Za-z\s.'-]+$/.test(value)) return false;
  return value.trim().split(/\s+/).length >= 2;
}

/** `Mr.`, `Mrs.`, `Shri` … — the one signal that a line is a person, not a heading. */
const HONORIFIC = /^(?:mr|mrs|ms|shri|smt|dr)\.?\s+/i;

/**
 * The account holder's name, from the three places statements print it: a
 * labelled `Name` row anywhere in the header, the first bare all-caps line near
 * the top, and a bare line opening with an honorific.
 *
 * The honorific case exists because IDFC prints `Mr. Priya Ramachandran Nair` in
 * title case, and an all-caps-only test silently found nothing — no error, no
 * warning, the name simply travelled into the prompt. Case is not a reliable
 * signal across banks; an honorific is, which is why it is the only thing that
 * licenses a non-all-caps line here. A bare title-case line without one stays
 * ignored on purpose: in this very statement the address (`Phule Nagar
 * Green Park`) is also title case, and masking that as the holder would both
 * miss the real name and corrupt the line.
 *
 * Only the *first* bare line of each kind is taken — later all-caps headings
 * ("IMPORTANT MESSAGE") would otherwise be mistaken for names.
 */
export function detectHolderNames(text: string): string[] {
  const found = new Set<string>();
  const lines = text.split('\n');
  let tookBareLine = false;

  // Stop where the transaction table starts, not at a fixed line count. A
  // continuation line inside the table is bare and capitalised and looks just
  // like a name — Standard Chartered wraps `ACME PAYROLL PRIVATE
  // LIMITED` under its salary credits, five lines inside the old fixed window.
  // Masking an employer as the holder would erase the counterparty on every
  // salary row, which is the one merchant on the statement worth naming.
  lines.slice(0, headerZoneEnd(lines)).forEach((rawLine) => {
    const cells = rawLine.split(CELL).map((cell) => cell.trim());

    for (let i = 0; i < cells.length - 1; i += 1) {
      const label = cells[i];
      const value = cells[i + 1];
      if (label === undefined || value === undefined) continue;
      if (/^(?:name|account\s*holder|customer\s*name)$/i.test(label) && isNameLike(value)) {
        found.add(value);
      }
    }

    // An honorific names a person wherever it appears, including the first
    // column of a row whose other columns are labelled fields — which is how
    // Standard Chartered lays its header out:
    //   `MR PRIYA RAMACHANDRAN NAIR | BRANCH | : | Central Branch`
    // There is no bare line to find there, so without this the holder is never
    // detected and never masked.
    const leading = cells[0];
    if (leading !== undefined && HONORIFIC.test(leading) && isNameLike(leading)) {
      found.add(leading);
    }

    if (tookBareLine) return;
    const filled = cells.filter((cell) => cell.length > 0);
    const single = filled.length === 1 ? filled[0] : undefined;
    if (single === undefined) return;

    const honorific = HONORIFIC.test(single);
    const allCaps = /^[A-Z][A-Z\s.]{5,48}$/.test(single);
    if ((honorific || allCaps) && isNameLike(single)) {
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
  const holderNames = detectHolderNames(normalised);
  const holderPatterns = holderNames
    .map(holderNamePattern)
    .filter((pattern): pattern is RegExp => pattern !== null);
  const holderTokens = holderNames.flatMap(holderTokenPatterns);

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
        const masked = `XXXX${digits.slice(-4)}`;
        if (digits.length >= 4 && value !== masked) {
          cells[i + 1] = masked;
          bump('accountNumber');
        }
      } else {
        if (value !== rule.mask) {
          cells[i + 1] = rule.mask;
          bump(labelKind(label));
        }
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
    joined = replaceCounting(
      joined,
      INLINE_ACCOUNT_NUMBER,
      (_match, label: string, digits: string) => `${label} : XXXX${digits.slice(-4)}`,
      () => bump('accountNumber'),
    );
    joined = replaceCounting(
      joined,
      INLINE_MICR,
      () => `MICR: ${MASK.micr}`,
      () => bump('micr'),
    );
    joined = replaceCounting(
      joined,
      EMAIL,
      () => MASK.email,
      () => bump('email'),
    );
    // Order matters here.
    //  - IFSC before VPA: a VPA's local part may contain hyphens
    //    (`gpay-12201811742@okbizaxis`), so without the IFSC already replaced
    //    the handle pattern runs left across `A-SBIN0004636-` and swallows a
    //    counterparty name's last letter along with it.
    //  - VPA before PHONE: many handles are `<mobile>@<bank>`, and masking the
    //    number first leaves the handle half-redacted.
    joined = replaceCounting(
      joined,
      IFSC,
      () => MASK.ifsc,
      () => bump('ifsc'),
    );
    joined = replaceCounting(
      joined,
      VPA,
      () => MASK.vpa,
      () => bump('upiHandle'),
    );
    joined = replaceCounting(
      joined,
      PHONE,
      () => MASK.phone,
      () => bump('phone'),
    );

    // 4. The holder's own name, wherever it appears, truncated or not.
    for (const pattern of holderPatterns) {
      joined = replaceCounting(
        joined,
        pattern,
        () => MASK.self,
        () => bump('holderName'),
      );
    }

    // 5. …then each of its words alone, for the pieces a wrap stranded where
    //    the whole-name pattern cannot reach them.
    for (const pattern of holderTokens) {
      joined = replaceCounting(
        joined,
        pattern,
        () => MASK.self,
        () => bump('holderName'),
      );
    }

    // 6. …and then whatever is still glued to the mask that leaves. A transfer
    //    alias like `PRIYARN01011990` is one token, so masking the name half
    //    strands a date of birth against a `SELF`.
    const collapsed = collapseMaskRemnants(joined);
    if (collapsed !== joined) bump('holderName');
    joined = collapsed;

    return joined;
  });

  const spilled = dropMaskSpill(redacted, lines);
  const rejoined = maskNamesSplitByWrap(spilled, holderPatterns, () => bump('holderName'));
  return { text: normaliseStatementText(rejoined.join('\n')), counts };
}

/** How far either side of a line break a split name is looked for. */
const MAX_WRAP_FRAGMENT = 14;

/**
 * Masks a holder name that only exists once two printed lines are put together.
 *
 * Redaction runs a line at a time, and `holderNamePattern` requires the first
 * name whole, so a bank that breaks `PRIYA` across a line boundary defeats
 * both: `…/AKS` ends one line, `HAY <surname>` begins the next, and neither
 * half is a name by itself. Nothing looked wrong — until a parser joined the
 * description back together, as IDFC's layout forces it to, and the name was
 * there again in the reassembled text.
 *
 * So the seam is checked directly: every suffix of one line against every
 * prefix of the next, and a pair that spells the holder is masked on both
 * sides. The first name cannot be made truncatable instead — a lone `A` would
 * then match half the statement.
 */
function maskNamesSplitByWrap(
  lines: string[],
  holderPatterns: RegExp[],
  bump: () => void,
): string[] {
  if (holderPatterns.length === 0) return lines;

  const matchesWhole = (candidate: string): boolean =>
    holderPatterns.some((pattern) => {
      pattern.lastIndex = 0;
      const found = pattern.exec(candidate);
      pattern.lastIndex = 0;
      return found !== null && found[0].length === candidate.length;
    });

  const out = [...lines];
  for (let i = 0; i < out.length - 1; i += 1) {
    const head = out[i];
    const tail = out[i + 1];
    if (head === undefined || tail === undefined) continue;

    // Only a letter run touching the break can be half of a split word.
    const headRun = /[A-Za-z]+$/.exec(head)?.[0] ?? '';
    const tailRun = /^[A-Za-z]+/.exec(tail)?.[0] ?? '';
    if (headRun.length < 2 || tailRun.length < 2) continue;

    for (let take = Math.min(headRun.length, MAX_WRAP_FRAGMENT); take >= 2; take -= 1) {
      const left = headRun.slice(-take);
      let matched = false;
      for (let give = Math.min(tailRun.length, MAX_WRAP_FRAGMENT); give >= 2; give -= 1) {
        if (!matchesWhole(left + tailRun.slice(0, give))) continue;
        out[i] = head.slice(0, head.length - take) + MASK.self;
        out[i + 1] = tail.slice(give);
        bump();
        matched = true;
        break;
      }
      if (matched) break;
    }
  }
  return out;
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
 * `…NAI`. When the head ends in a mask, the continuation's leading word run
 * is the rest of the value that was masked, and goes with it.
 */
export function joinWrappedDetail(head: string, tail: string): string {
  if (!MASK_AT_END.test(head)) return head + tail;
  const rest = tail.slice(maskSpillLength(tail));
  // A mask can also have swallowed the delimiter that separated two fields
  // (`T-IDFB-<mobile>@idfcfirst` is all one handle), leaving two masks flush
  // against each other. Put the delimiter back rather than emit `SELF[vpa]`.
  if (rest.startsWith('[')) return `${head}-${rest}`;
  return head + rest;
}

/** How far into a continuation a masked value's tail can plausibly run. */
const MAX_SPILL = 40;

/**
 * How much of a wrapped continuation belongs to a value that was masked on the
 * line above.
 *
 * Everything up to the continuation's first structural delimiter — the whole
 * run, not just the first word, because a name wraps as `…PRIYA RA` +
 * `MACHANDRAN NAI-XXXX9652-…` and stopping at the space leaves the surname behind.
 * A continuation that already begins with a mask spilled nothing.
 */
export function maskSpillLength(tail: string): number {
  if (tail.startsWith('[')) return 0;
  const delimiter = tail.search(/[-/@\t]/);
  if (delimiter >= 0 && delimiter <= MAX_SPILL) return delimiter;
  // No delimiter within reach: take the leading word run only, so a
  // continuation that is just more prose is not swallowed whole.
  return tail.match(/^[A-Za-z0-9.@_]+/)?.[0].length ?? 0;
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
  out = collapseMaskRemnants(out);
  return out;
}

/**
 * A run of characters touching a `SELF`, with at most the space a wrap left.
 *
 * The digits matter as much as the letters. Standard Chartered prints a
 * transfer alias as `PRIYARN01011990` — the holder's name run together with
 * what is plainly a date of birth. Masking the name half leaves `SELF01011990`,
 * which still carries it. A run glued straight onto a mask with no separator is
 * part of the same token, so it goes with it; a run with a space between is
 * only taken when it is letters, since `SELF 500` is two things rather than a
 * handle.
 */
const SELF_REMNANT = /(?:SELF){2,}|\b[A-Za-z]{1,8} ?SELF\b|\bSELF[A-Za-z0-9]{1,14}\b/g;

/**
 * Drops the letters left stranded either side of a `SELF`.
 *
 * A description assembled from wrapped lines can put a name back together that
 * no single line contained. IDFC breaks `PRIYA` into `AKS` at the end of one
 * printed line and `HAY <surname>` in the middle of the next; per-line
 * redaction masks the surname and leaves both fragments, because neither is a
 * name on its own. Rejoin them — which is precisely what a parser must do to
 * read the description at all — and `…/PRIYA SELF/…` is back.
 *
 * The line-level passes cannot prevent this. They do not know which cells a
 * parser will keep, and here it keeps the two fragments while dropping the
 * dates and amounts printed between them, so the pieces only become adjacent
 * after the parser has chosen. The reliable signal is at the seam instead: a
 * `SELF` is only ever emitted where a name was removed, so letters still stuck
 * to one are the rest of that name. They go.
 *
 * Only the leading side tolerates a space, because that is where the evidence
 * is: `HAY SELF` is a broken first name beside a masked surname. On the
 * trailing side a space means a separate word — `SELF IDFC FIRST BANK` names
 * the bank the money went to — so only a run glued straight on is taken.
 *
 * The cost is a `TO SELF` becoming `SELF`, which loses nothing that
 * categorisation uses — a self-transfer is what both say.
 */
function collapseMaskRemnants(text: string): string {
  // Deliberately one pass. Scanning resumes after each match, so a replacement
  // cannot be re-examined — which is what stops `SELF01011990 IDFC FIRST BANK`
  // from collapsing to `SELF` one word at a time, each round eating the next
  // word of a counterparty that was never part of the name. Runs of masks are
  // handled inside the pattern instead, which is why they come first in it.
  return text.replace(SELF_REMNANT, MASK.self);
}

/**
 * Redaction runs a line at a time, but a statement that hard-wraps a field
 * mid-word leaves the truncated head on one line and its tail on the next,
 * where the per-line pass cannot see what it belongs to. `…TO PRIYA RA`
 * becomes `…TO SELF` and the next line still begins `MACHANDRAN NAI-…`.
 *
 * So: a single-cell line following a multi-cell row that masked one of its
 * cells at the end — in this pass — is a wrapped continuation, and its leading
 * run is the rest of the masked value. It goes.
 */
function dropMaskSpill(lines: string[], before: string[]): string[] {
  const out = [...lines];
  for (let i = 1; i < out.length; i += 1) {
    const line = out[i];
    const previous = out[i - 1];
    if (line === undefined || previous === undefined) continue;
    if (line.includes(CELL)) continue;

    const previousCells = previous.split(CELL);
    if (previousCells.length < 3) continue;

    // Only a mask made by *this* pass can have left a tail behind. A mask that
    // was already there — text redacted once in the browser, arriving at the
    // server — spilled on the first pass and was cleaned up then; treating it
    // as new would eat the next line's first word again on every pass.
    const originalCells = (before[i - 1] ?? '').split(CELL);
    const maskedHere = previousCells.some(
      (cell, index) =>
        MASK_AT_END.test(cell.trim()) && !MASK_AT_END.test((originalCells[index] ?? '').trim()),
    );
    if (!maskedHere) continue;

    out[i] = line.slice(maskSpillLength(line));
  }
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
    const groups = args.filter((arg): arg is string => typeof arg === 'string');
    const replacement = replacer(match, ...groups);
    // Re-masking what is already masked is not a removal, and must not be
    // counted as one — the server's second pass reports what *it* removed.
    if (replacement !== match) onMatch();
    return replacement;
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
