import { renameSync, writeFileSync } from 'node:fs';
import { validateBeatmap } from '../engine/beatmap.js';
import type { Beatmap } from '../engine/types.js';
import type { Plugin } from 'vite';

const ROUTE = '/__beatmap';
/** Limit ciala requestu (rozstrzygniecie #5, ADR-0016) — przyblizenie po dlugosci
    stringa, wystarczajace dla malego JSON-a beatmapy. */
const MAX_BODY_CHARS = 1024 * 1024;

/**
 * Vite bundluje wlasne typy `Connect.IncomingMessage`/`http.ServerResponse`
 * przez `import ... from 'node:http'`, ktorego bez `@types/node` (projekt
 * celowo go nie ma) nie da sie rozwiazac — typy tych parametrow wychodza
 * praktycznie puste. Zamiast dokladac zaleznosc, opisujemy lokalnie minimum,
 * jakiego faktycznie uzywamy, i rzutujemy na starcie handlera (ADR-0016).
 */
interface DevRequest {
  method?: string;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  destroy(): void;
}

interface DevResponse {
  statusCode: number;
  end(data?: string): void;
}

/**
 * Plugin dev-only (nigdy w buildzie — `apply: 'serve'`) zapisujacy beatmape
 * nagrana w trybie deweloperskim z powrotem na dysk (ADR-0016). Jedyna trasa:
 * `POST /__beatmap`. Sciezka docelowa liczona wylacznie z `server.config.root`
 * — nigdy z requestu. Zapis atomowy: `.tmp` -> `renameSync`.
 */
export function beatmapWritePlugin(): Plugin {
  return {
    name: 'beatmap-write',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ROUTE, (rawReq, rawRes) => {
        const req = rawReq as unknown as DevRequest;
        const res = rawRes as unknown as DevResponse;

        if (req.method !== 'POST') {
          res.statusCode = 404;
          res.end();
          return;
        }

        let body = '';
        let tooLarge = false;

        req.on('data', (chunk) => {
          if (tooLarge) return;
          body += chunk;
          if (body.length > MAX_BODY_CHARS) {
            tooLarge = true;
            res.statusCode = 400;
            res.end('Beatmapa: cialo requestu przekracza limit 1 MB.');
            req.destroy();
          }
        });

        req.on('end', () => {
          if (tooLarge) return;
          try {
            const data = JSON.parse(body) as Beatmap;
            // Bez sprawdzenia rejestru sprite'ow — src/sprites.ts uzywa
            // import.meta.env.BASE_URL i wysadziloby sie przy ewaluacji w
            // Node. Rejestr sprawdza klient przed wyslaniem (rozstrzygniecie #5).
            validateBeatmap(
              data,
              data.objects.map((o) => o.sprite),
            );

            const target = `${server.config.root}/src/data/beatmap.json`;
            const tmp = `${target}.tmp`;
            writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
            renameSync(tmp, target);

            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 400;
            res.end(`Beatmapa: ${(error as Error).message}`);
          }
        });

        req.on('error', () => {
          res.statusCode = 500;
          res.end();
        });
      });
    },
    // Beatmapa w pamieci silnika jest zrodlem prawdy (rozstrzygniecie #1) —
    // zapis na dysk to efekt uboczny, ktory nie powinien przeladowywac gry.
    handleHotUpdate(ctx) {
      return ctx.file.includes('data/beatmap.json') ? [] : undefined;
    },
  };
}
