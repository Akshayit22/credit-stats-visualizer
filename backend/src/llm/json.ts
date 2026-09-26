import { LlmResponseError } from './provider.js';

/**
 * Getting JSON back out of a language model.
 *
 * We ask for JSON and nothing else, and then we assume the model ignored us:
 * markdown fences, a sentence of preamble and a trailing "Let me know if…" are
 * all routine. This strips those defensively rather than trusting the prompt.
 */

/** ```json … ``` or ``` … ``` */
const FENCE = /^\s*```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

export function stripFences(raw: string): string {
  const fenced = raw.match(FENCE);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  return raw.trim();
}

/**
 * Finds the outermost JSON value in a string that may carry prose around it.
 * Brace-counting, not a regex: a merchant name containing `}` would defeat a
 * regex, and merchant names are exactly what this JSON is full of.
 */
export function extractJsonBody(raw: string): string {
  const text = stripFences(raw);
  const start = text.search(/[[{]/);
  if (start === -1) return text;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

export function parseJsonResponse(providerId: string, raw: string): unknown {
  const body = extractJsonBody(raw);
  try {
    return JSON.parse(body);
  } catch {
    throw new LlmResponseError(
      providerId,
      // The response itself is never quoted: it is derived from statement text.
      `The model did not return JSON (${body.length} characters, starting "${body.slice(0, 1)}").`,
    );
  }
}
