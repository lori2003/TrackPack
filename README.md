# TrackPack

Applicazione mobile-first per gestire i codici tracking dei pacchi.

## Struttura

- Il sito pubblico è pubblicato dal branch `gh-pages`.
- L’app è composta da una sola versione: `index.html`, `app.css`, `app.js`, `manifest.json` e `icon.svg`.
- Non usa più service worker o script di correzione sovrapposti, evitando cache obsolete e cicli di ricaricamento.
- I dati sincronizzati vengono salvati cifrati in `data/packages.enc.json` sul branch `main`.

## Funzioni

- Stati semplificati: **In attesa** e **Consegnato**.
- Aggiunta, ricerca, rinomina, archiviazione ed eliminazione dei pacchi.
- Tracking INPOST visualizzato direttamente nell’app.
- Aggiornamento automatico INPOST quando la spedizione risulta consegnata.
- Sincronizzazione cifrata con GitHub tramite token fine-grained.
- Compatibilità con il precedente formato cifrato, così i dati già salvati non vengono persi.

Sito: https://lori2003.github.io/TrackPack/
