/** Minimalny shim `node:zlib` dla testu generatora assetow (ADR-0027).
    Projekt celowo nie ma `@types/node` — dodanie zaleznosci wymagaloby zapytania,
    a test potrzebuje wylacznie jednej funkcji. Ten sam wzorzec co
    `src/dev/node-shims.d.ts`. */
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
