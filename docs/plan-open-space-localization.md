# Lepší lokalizace ve velkých monotónních místnostech (open space)

## Kontext

Dnešní lokalizace: MobileNet v2 (alpha 0.5) embedding celého snímku → cosine k-NN proti naučeným pohledům
uzlů (`visionMatcher.ts`), k tomu bonus za blízkost poslední potvrzené polohy (`locationPrior.ts`,
kruh 15 m kolem posledního fixu, slábne za 5 min). PDR (`pdr.ts`, `usePDR.ts`) jen počítá kroky a
posouvá tečku po předem zvolené trase; kurz z kompasu se do lokalizace nepoužívá.

Proč to v open space selhává:

1. Globální ImageNet embedding zachytí "jak vypadá open space" (stoly, strop, světla), ne kde v něm jsem.
   Všechny uzly mají podobné skóre (85–95 %), takže `pickAutoMatch` (margin 8 b.) nikdy nepotvrdí
   a uživatel vybírá ručně.
2. Pohled záleží na směru pohledu, ne jen na místě. Vzorky nemají uložený kurz, takže se míchají.
3. Prior je statický disk kolem posledního fixu; nezná ušlou vzdálenost ani směr chůze.
4. Rozhoduje jediný snímek (2 po sobě jdoucí), žádné časové vyhlazování.
5. Chybí měření, jak moc jsou si které uzly podobné, takže nevíme, kde stačí software a kde je nutný QR.

## Doporučený postup (od nejlevnějšího/nejúčinnějšího)

### 1. Diagnostika zaměnitelnosti (základ pro všechno ostatní)

- [x] `src/services/confusability.ts`: leave-one-out nad uloženými vzorky mapy, top-1 přesnost a
      matice/seznam nejvíc zaměnitelných dvojic uzlů
- [x] Testy v `src/services/__tests__/confusability.test.ts`
- [x] Zobrazit v editoru jako "tyto uzly se pletou, přidej QR marker" (navazuje na plan-walkthrough-coverage)

### 2. Odečtení společné složky (mean-centering) + kontrast skóre

- [x] V `visionMatcher.ts` spočítat průměrný vektor všech vzorků mapy a před cosine ho odečíst od živého
      vektoru i vzorků (odstraní "vzhled open space", zůstane to, co uzly odlišuje)
- [x] `rankMatches` dostane volitelný `center` vektor; uložená data se nemění
- [x] Testy: dva uzly s velkou společnou složkou se po centrování rozliší; bez `center` stejné chování jako dnes
- [ ] Přelaďit `AUTO_SCORE`/`AUTO_MARGIN` ve `VisionScannerModal.tsx` (skóre po centrování má jiné rozložení)

### 3. Vzorky s kurzem

- [x] `EmbeddingSample` (`types/vision.ts`) + Zod schéma v `mapStorage.ts`: volitelné `headingDeg`
      (starší mapy bez něj fungují dál)
- [x] Při nahrávání průchodu ukládat kurz z `useOrientation`; při rozpoznávání porovnávat přednostně
      vzorky s kurzem ±45° (váha, ne filtr)
- [x] Testy schématu a váhování

### 4. Prior s PDR a kurzem místo statického disku

- [ ] `locationPrior.ts`: místo "blízko fixu" dávat bonus uzlům, jejichž graf. vzdálenost od fixu odpovídá
      ušlé vzdálenosti (`pdr.distanceM`, tolerance roste s ušlou cestou kvůli driftu)
- [ ] Kurz (`useOrientation` + `northOffsetDeg`) vybere hranu/směr; chodba bez větvení = silný prior
- [ ] Reset PDR při každém potvrzeném fixu
- [ ] Testy na grafu s více větvemi

### 5. Časové vyhlazení

- [ ] Průměrovat skóre uzlů přes posledních N snímků (klouzavé okno) v `VisionScannerModal` / nové
      čisté funkci v `services/`, potvrzovat na vyhlazených skóre

### 6. Silnější příznaky (jen pokud 2–5 nestačí)

- [ ] Prostorové dlaždice (např. 2×2 embedding + globální) místo jednoho vektoru; zachová rozložení scény
- [ ] Případně větší model (alpha 1.0) – pozor na velikost a načítání, TF.js musí zůstat v lazy chunku

### 7. Ne-softwarová složka

- [ ] V open space umístit QR/čárové markery na sloupy a na pravidelné uzly (mřížka ~10–15 m);
      `findNodeByCode` už existuje. Editor by je měl doporučovat podle bodu 1.

## Doporučení

Začít body 1 + 2 (čisté služby v `src/services/`, testovatelné, bez změny dat), pak 3 + 4.
Bod 6 a 7 až podle výsledků diagnostiky.

## Ověření

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- Na exportované mapě open space: top-1 přesnost leave-one-out před/po bodech 2–3 (bod 1)
- Ruční test na telefonu přes `npm run dev:host`: stoj na 5 uzlech, porovnej počet automatických potvrzení
  vs. ručních výběrů před/po

## Kritické soubory

`src/services/visionMatcher.ts`, `src/services/locationPrior.ts`, `src/services/pdr.ts`,
`src/hooks/usePDR.ts`, `src/hooks/useOrientation.ts`, `src/components/scanner/VisionScannerModal.tsx`,
`src/types/vision.ts`, `src/services/mapStorage.ts`
Po schválení uložit jako `docs/plan-open-space-localization.md` (checklist).
