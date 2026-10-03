/**
 * `AbortController` and `AbortSignal`, which Node has had since v15 and
 * `@types/node` no longer declares.
 *
 * As of @types/node 24 the fetch family (`fetch`, `Response`, `Request`) is
 * declared but the abort family is not: upstream expects those two to arrive
 * from `lib.dom`. This backend deliberately does not load `lib.dom` — doing so
 * would also type `window`, `document` and `localStorage` as available on a
 * server that must never touch them, turning a crash into a clean compile.
 *
 * So they are declared here instead, narrowly, with only the surface the
 * runtime actually provides. Delete this file the day @types/node ships them.
 */
export {};

declare global {
  interface AbortSignal {
    readonly aborted: boolean;
    readonly reason: unknown;
    throwIfAborted(): void;
    addEventListener(type: 'abort', listener: () => void): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  }

  interface AbortController {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
  }

  var AbortSignal: {
    prototype: AbortSignal;
    new (): AbortSignal;
    abort(reason?: unknown): AbortSignal;
    /** Aborts after `milliseconds` — how every fetch here is bounded. */
    timeout(milliseconds: number): AbortSignal;
    any(signals: readonly AbortSignal[]): AbortSignal;
  };

  var AbortController: {
    prototype: AbortController;
    new (): AbortController;
  };
}
