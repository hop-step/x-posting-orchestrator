import twitterText from "twitter-text";

export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

export function characterCount(text: string): number {
  return Array.from(text).length;
}

export function isTweetLengthValid(text: string): boolean {
  return twitterText.parseTweet(text).valid;
}

export const STANDARD_POST_WEIGHTED_LENGTH = 280;
export const LONGFORM_POST_CHARACTER_LIMIT = 25_000;
