import { CATEGORIES } from '@/shared/categories';

/**
 * The prompts. They are short on purpose: the model's job is transcription and
 * arithmetic on text it can see, not inference about banking.
 *
 * Every prompt is built from text that has been through `redactForLlm`, so
 * nothing here can carry a name, an address, a phone number, an email, a
 * customer id, an account number or a reference id.
 */

export const EXTRACT_SYSTEM = [
  'You read Indian bank and credit card statements and return structured data.',
  '',
  'Rules, in order of importance:',
  '1. Return only JSON. No markdown fences, no commentary before or after.',
  '2. Every money field is an INTEGER NUMBER OF PAISE. ₹1,234.56 is 123456.',
  '   Never a decimal, never a string, never negative for an amount.',
  '3. `amountMinor` is always positive. Direction is carried by `direction`:',
  '   "debit" for money leaving the account or charged to the card, "credit"',
  '   for money arriving or credited.',
  '4. Copy figures exactly as printed. Do not compute, round, or correct them.',
  '   If the statement does not print a figure, use 0 — never a guess.',
  '5. Dates are ISO `YYYY-MM-DD`. Indian statements print day first:',
  '   `05/07/2026` is 5 July 2026, never 7 May.',
  '6. Only rows in the transaction table are transactions. A schedule of',
  '   charges, an interest-calculation example, a minimum-payment-due worked',
  '   example and a terms-and-conditions page are NOT transactions, however',
  '   many amounts and dates they contain.',
  '7. `last4` is the last four digits of the account or card number only.',
  '8. `merchant` is who the money went to or came from, pulled out of the',
  '   description: "UPI/BLINKIT/blinkit@ybl" is "Blinkit", "NEFT SALARY',
  '   CREDIT" is "Salary". Never leave it empty when the description names',
  '   anyone — it is what the spending categories are worked out from.',
  '',
  'The text you are given has already had personal details removed. Tokens like',
  '`SELF`, `[vpa]`, `[ifsc]` and `XXXX9581` are those removals — treat them as',
  'opaque, keep them as they are, and never try to reconstruct what they hid.',
].join('\n');

export function extractUserPrompt(
  text: string,
  hint: { issuer: string; accountType: string },
): string {
  return [
    `This looks like a ${hint.accountType === 'savings' ? 'savings account' : 'credit card'} statement`,
    `from ${hint.issuer}. Extract it.`,
    '',
    'Pay particular attention to the statement’s own summary figures — the',
    'opening and closing balance, or the previous balance, payments, credits,',
    'purchases and total due. Those are what the numbers are checked against.',
    '',
    'The statement text follows. Lines are printed lines; TAB separates columns.',
    '',
    text,
  ].join('\n');
}

export const CATEGORISE_SYSTEM = [
  'You assign a spending category to Indian merchant names.',
  '',
  'Rules:',
  '1. Return only JSON. No markdown fences, no commentary.',
  '2. Use only these categories, spelled exactly:',
  `   ${CATEGORIES.join(', ')}.`,
  '3. One entry per merchant you were given, using the merchant string verbatim.',
  '4. A personal name with no business signal is "Cash & transfers", not a guess',
  '   at what they might sell.',
  '5. "SELF" means the account holder moving their own money: "Cash & transfers".',
  '6. When a name genuinely gives you nothing, answer "Uncategorised". That is a',
  '   correct answer, not a failure.',
].join('\n');

export function categoriseUserPrompt(merchants: readonly string[]): string {
  return [
    'Categorise these merchants:',
    '',
    ...merchants.map((merchant) => `- ${merchant}`),
  ].join('\n');
}

/**
 * Appends the JSON Schema the answer has to satisfy.
 *
 * Every provider takes a `jsonSchema` and, until this existed, every provider
 * ignored it — the model was told the rules in prose and never told the field
 * names, so it invented its own shape and failed validation twice. Putting the
 * schema in the prompt works on every provider, including the ones with no
 * structured-output mode at all.
 */
export function withSchema(user: string, schema: object): string {
  return [
    user,
    '',
    '---',
    'Return JSON matching this schema exactly. Every required field must be',
    'present, spelled exactly as written here, at the level shown.',
    '',
    JSON.stringify(schema),
  ].join('\n');
}

/** Appended verbatim on the single retry, so the model sees its own mistake. */
export function retryPrompt(previous: string, validationError: string): string {
  return [
    previous,
    '',
    '---',
    'Your previous answer did not match the required schema:',
    validationError,
    '',
    'Return corrected JSON. Only JSON.',
  ].join('\n');
}
