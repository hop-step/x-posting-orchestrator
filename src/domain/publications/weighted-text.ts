import twitterText from "twitter-text";

export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

export function isTweetLengthValid(text: string): boolean {
  return twitterText.parseTweet(text).valid;
}

export const STANDARD_POST_WEIGHTED_LENGTH = 280;
