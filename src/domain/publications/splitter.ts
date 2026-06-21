import { unprocessable } from "../../shared/errors";
import { STANDARD_POST_WEIGHTED_LENGTH, weightedLength } from "./weighted-text";

export interface SplitThreadOptions {
  numbering: boolean;
  maxParts: number;
  maxWeightedLength?: number;
}

interface Token {
  text: string;
  breakableBefore: boolean;
}

const urlPattern = /https?:\/\/[^\s]+/gu;

export function splitIntoThread(text: string, options: SplitThreadOptions): string[] {
  const maxWeightedLength = options.maxWeightedLength ?? STANDARD_POST_WEIGHTED_LENGTH;
  const parts = splitWithoutNumbering(text, options.maxParts, maxWeightedLength, options.numbering);
  if (!options.numbering) {
    ensurePartsValid(parts, options.maxParts, maxWeightedLength);
    return parts;
  }

  let current = parts;
  for (let i = 0; i < 4; i += 1) {
    const numbered = current.map((part, index) => `${part.trimEnd()}\n\n(${index + 1}/${current.length})`);
    ensurePartsValid(numbered, options.maxParts, maxWeightedLength);
    const recalculated = splitWithoutNumbering(text, options.maxParts, maxWeightedLength, true, current.length);
    if (recalculated.length === current.length) {
      return numbered;
    }
    current = recalculated;
  }
  throw unprocessable("THREAD_SPLIT_UNSTABLE", "Thread split could not be stabilized.");
}

function splitWithoutNumbering(
  text: string,
  maxParts: number,
  maxWeightedLength: number,
  reserveNumbering: boolean,
  expectedParts = maxParts
): string[] {
  const reserve = reserveNumbering ? weightedLength(`\n\n(${expectedParts}/${expectedParts})`) : 0;
  const effectiveMax = maxWeightedLength - reserve;
  const tokens = tokenizePreservingUrls(text);
  const parts: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = `${current}${token.text}`;
    if (weightedLength(candidate) <= effectiveMax) {
      current = candidate;
      continue;
    }

    if (current.trim().length === 0) {
      throw unprocessable("THREAD_TOKEN_TOO_LONG", "A URL or grapheme cluster is too long to fit in a post.");
    }
    parts.push(current.trimEnd());
    if (parts.length > maxParts) {
      throw unprocessable("MAX_THREAD_PARTS_EXCEEDED", "Thread exceeds maxParts.", { maxParts });
    }
    current = token.breakableBefore ? token.text.trimStart() : token.text;
  }

  if (current.trim().length > 0) {
    parts.push(current.trimEnd());
  }
  ensurePartsValid(parts, maxParts, maxWeightedLength);
  return parts;
}

function tokenizePreservingUrls(text: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push(...graphemeTokens(text.slice(cursor, index)));
    }
    tokens.push({ text: match[0], breakableBefore: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    tokens.push(...graphemeTokens(text.slice(cursor)));
  }
  return tokens;
}

function graphemeTokens(text: string): Token[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(text)].map((segment) => ({
    text: segment.segment,
    breakableBefore: true
  }));
}

function ensurePartsValid(parts: string[], maxParts: number, maxWeightedLength: number): void {
  if (parts.length === 0) {
    throw unprocessable("EMPTY_THREAD", "Thread cannot be empty.");
  }
  if (parts.length > maxParts) {
    throw unprocessable("MAX_THREAD_PARTS_EXCEEDED", "Thread exceeds maxParts.", { maxParts });
  }
  for (const [index, part] of parts.entries()) {
    const length = weightedLength(part);
    if (length > maxWeightedLength) {
      throw unprocessable("THREAD_PART_TOO_LONG", "Thread part exceeds weighted length limit.", {
        sequence: index + 1,
        weightedLength: length,
        maxWeightedLength
      });
    }
  }
}
