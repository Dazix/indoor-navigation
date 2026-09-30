# Plan: automatické přepnutí na nejbližší mapu podle polohy

## Context

Při otevření stránky se má aktivovat mapa nejblíže poloze uživatele. Pokud stránka přišla přes odkaz (`?map=`, `?to=`, `?cloudMap=`/`?cfg=`), odkaz má přednost a auto-přepnutí se přeskočí.

Rozhodnutí: poloha mapy = nové volitelné pole `metadata.geo {lat,lng}`; přepíná se jen při startu; mimo limit / bez GPS zůstává poslední aktivní mapa (bez hlášky).

## Kroky

- [x] Model: `src/types/map.ts` – `MapMetadata.geo?: { lat: number; lng: number }`; `MapSummary.geo?` (index v localStorage, aby se při startu nenačítaly těla map z IndexedDB).
- [x] Zod: `src/services/mapStorage.ts` – optional `geo` (lat −90..90, lng −180..180) v metadata; `src/services/mapLibrary.ts` `MapLibrarySchema` – optional `geo` u summary. Staré mapy platné dál.
- [x] Knihovna: `src/hooks/useMapLibrary.ts` – tam, kde se skládá/aktualizuje summary (řádky ~87, 106, 195, 227, 250) kopírovat `metadata.geo` do summary. Přidat `setActiveMap(id)` použití existujícího přepnutí (řádek ~258).
- [x] Služba `src/services/nearestMap.ts` (čistá): `haversineM(a,b)`, `pickNearestMap(maps, pos, maxM = 500)` → `MapSummary | null` (ignoruje mapy bez `geo`, null mimo limit).
- [x] Testy `src/services/__tests__/nearestMap.test.ts`: nejbližší vyhrává, mapy bez geo přeskočeny, mimo limit → null, prázdná knihovna → null, remíza deterministicky. Rozšířit testy mapStorage/mapLibrary o `geo` (validní, mimo rozsah, chybí).
- [x] Hook `src/hooks/useAutoMapByLocation.ts`: jednorázový `navigator.geolocation.getCurrentPosition` (timeout ~8 s, `maximumAge` 5 min); chyby/zamítnutí tiše ignorovat; parametr `enabled`.
- [x] Zapojení v `src/App.tsx`: `enabled` jen když `libraryStatus === 'ready'`, `INITIAL_MAP_LINK === null`, `INITIAL_TARGET === null`, `INITIAL_CLOUD_CONFIG === null` (odkaz respektován) a `mapLinkDone`. Spustit max jednou za načtení stránky; jeden běh, nepřepisovat, pokud uživatel mezitím mapu přepnul ručně.
- [x] Editor: `src/components/editor/EditorSidebar.tsx` – sekce „Poloha mapy": tlačítko „Nastavit z aktuální polohy" (geolocation), ruční lat/lng inputy, tlačítko smazat. Uložit přes `onMetadataChange({ geo })`.
- [x] Docs: `README.md` – krátká sekce (geo v editoru, chování při startu, přednost odkazů); poznámka v `CLAUDE.md` u gotchas není nutná.
- [x] Ověření: `npm run typecheck && npm run lint && npm test && npm run build`.

## Ověření end-to-end

1. `npm run dev:host`, dvě mapy s různým `geo`; v DevTools Sensors nastavit polohu poblíž mapy B → po načtení aktivní mapa B.
2. Poloha daleko (>500 m) nebo zamítnuté oprávnění → zůstane poslední aktivní mapa, bez chyby.
3. `/?to=<node>` a `/?map=<url>` a `/?cloudMap=<id>` → auto-přepnutí neproběhne, odkaz funguje jako dřív.
4. Staré mapy bez `geo` se načtou beze změny.
