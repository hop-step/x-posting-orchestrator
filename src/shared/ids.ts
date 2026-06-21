const DEFAULT_BYTES = 16;

export interface IdGenerator {
  newId(prefix: string): string;
}

export const randomIdGenerator: IdGenerator = {
  newId(prefix: string): string {
    return `${prefix}_${randomHex(DEFAULT_BYTES)}`;
  }
};

export function randomHex(bytes = DEFAULT_BYTES): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class SequenceIdGenerator implements IdGenerator {
  private index = 0;

  newId(prefix: string): string {
    this.index += 1;
    return `${prefix}_${this.index.toString().padStart(6, "0")}`;
  }
}
