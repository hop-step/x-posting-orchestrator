export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now()
};

export class FixedClock implements Clock {
  constructor(private currentMs: number) {}

  nowMs(): number {
    return this.currentMs;
  }

  set(ms: number): void {
    this.currentMs = ms;
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}
