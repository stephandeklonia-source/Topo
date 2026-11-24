# TopoQuiz 🌍

Topografie-pubquiz voor groep 7 & 8, gebaseerd op het topoboekje 2026–2027.

## Zo werkt het
1. Vul je naam in, kies het onderwerp (de eerstvolgende toets staat al klaar) en het aantal vragen per ronde.
2. **Ronde 1 – Meerkeuze:** kies het goede antwoord uit vier.
3. **Ronde 2 – Galgje:** raad de naam letter voor letter (8 fouten = opgehangen).
4. **Ronde 3 – Zelf typen:** typ de naam zelf. Hoofdletters/accenten tellen niet mee, spelling wel.

De tijd loopt mee tijdens de vragen. Op het scorebord staat hoeveel vragen je **in 1x goed** had
en hoe lang je erover deed (meeste goed bovenaan, bij gelijke stand wint de snelste).
Het scorebord hoort bij de eerstvolgende toets: de dag na de toets is het weer leeg. Scores worden in de browser bewaard (alleen op dat apparaat).

## Online zetten met GitHub Pages
1. Ga in deze repository naar **Settings → Pages**.
2. Kies bij *Source* **Deploy from a branch**, selecteer de branch en map `/ (root)` en klik **Save**.
3. Na ongeveer een minuut staat de quiz op `https://<gebruikersnaam>.github.io/<repository>/`.

## Bestanden
- `index.html`, `style.css`, `app.js` – de quiz
- `data.js` – alle topo-onderwerpen, antwoorden en coördinaten (hier kun je dingen toevoegen of aanpassen)
- `vendor/` – Leaflet (kaart), topojson-client en landsgrenzen (world-atlas / Natural Earth)

Kaarttegels: © OpenStreetMap-bijdragers © CARTO.
