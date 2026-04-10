// --- Default export (should be ignored by the runtime) ---
export default function ignored() {
  return "This should not be accessible";
}

// --- Async function ---
export async function greet(name: string): Promise<string> {
  return `Hello, ${name}!`;
}

// --- Sync function (becomes async over network) ---
export function add(a: number, b: number): number {
  return a + b;
}

// --- Function that throws ---
export function willThrow(): never {
  throw new Error("intentional error");
}

// --- Async generator ---
export async function* countUp(start: number, end: number): AsyncGenerator<number> {
  for (let i = start; i <= end; i++) {
    await new Promise((r) => setTimeout(r, 5));
    yield i;
  }
}

// --- Nested object with methods ---
export const math = {
  multiply(a: number, b: number): number { return a * b; },
  divide(a: number, b: number): number {
    if (b === 0) throw new Error("division by zero");
    return a / b;
  },
  PI: 3.14159,
};

// --- ReadableStream ---
export function streamData(count: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= count) { controller.close(); return; }
      await new Promise((r) => setTimeout(r, 5));
      controller.enqueue(new TextEncoder().encode(`chunk-${i++}\n`));
    },
  });
}

// --- Class ---
export class Counter {
  private count: number;
  public label: string;
  constructor(initial: number = 0, label: string = "default") {
    this.count = initial;
    this.label = label;
  }
  increment(): number { return ++this.count; }
  decrement(): number { return --this.count; }
  getCount(): number { return this.count; }
  getLabel(): string { return this.label; }
  async asyncIncrement(): Promise<number> {
    await new Promise((r) => setTimeout(r, 5));
    return ++this.count;
  }
}

// --- Devalue round-trip ---
export function echo(value: any): any { return value; }

// --- Various return types for devalue ---
export function getDate(): Date { return new Date("2025-01-01T00:00:00.000Z"); }
export function getRegExp(): RegExp { return /hello/gi; }
export function getBigInt(): bigint { return 9007199254740993n; }
export function getSet(): Set<number> { return new Set([1, 2, 3]); }
export function getMap(): Map<string, number> { return new Map([["a", 1], ["b", 2]]); }
export function getSpecialNumbers(): object {
  return { nan: NaN, inf: Infinity, negInf: -Infinity, negZero: -0 };
}
export function getNestedObject(): object { return { a: { b: { c: 42 } } }; }
export function getTypedArray(): Uint8Array { return new Uint8Array([1, 2, 3, 4, 5]); }

// --- Constants ---
export const VERSION = "1.0.0";
export const MAX_COUNT = 100;

// --- Edge case: empty generator (start > end) ---
export async function* emptyGen(): AsyncGenerator<number> {}

// --- Edge case: generator that throws mid-iteration ---
export async function* throwingGen(): AsyncGenerator<number> {
  yield 1;
  yield 2;
  throw new Error("generator exploded");
}

// --- Edge case: function returning undefined explicitly ---
export function returnUndefined(): undefined { return undefined; }
export function returnNull(): null { return null; }

// --- Edge case: large payload ---
export function largeArray(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

// --- Edge case: deeply nested path ---
export const deep = {
  level1: {
    level2: {
      level3: {
        value: 42,
        fn(x: number): number { return x * 2; },
      },
    },
  },
};

// --- Edge case: async function that takes a long time ---
export async function slowFunction(ms: number): Promise<string> {
  await new Promise((r) => setTimeout(r, ms));
  return "done";
}

// --- Edge case: multiple return types ---
export function echoAll(...args: any[]): any[] { return args; }

// --- Edge case: URL and URLSearchParams ---
export function getUrl(): URL { return new URL("https://example.com/path?q=1"); }
export function getUrlSearchParams(): URLSearchParams {
  return new URLSearchParams("a=1&b=2&c=3");
}
