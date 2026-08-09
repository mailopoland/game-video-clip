/** Minimalny shim `node:fs` — projekt celowo nie ma `@types/node` (ADR-0016).
    Dodanie zaleznosci wymagaloby zapytania, a ten plugin dev-only potrzebuje
    wylacznie tych dwoch funkcji. */
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
  export function renameSync(oldPath: string, newPath: string): void;
}
