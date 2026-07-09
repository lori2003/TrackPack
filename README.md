# TrackPack

Applicazione mobile-first per salvare e gestire codici tracking dei pacchi.

## Funzioni

- Salvataggio locale nel browser, senza account o server
- Gestione pacchi attivi e archiviati
- Ricerca, filtri e ordinamento
- Stato manuale della spedizione
- Apertura del tracking ufficiale per i corrieri supportati
- Supporto PWA e funzionamento offline dopo il primo caricamento
- INPOST incluso, con il codice `827049017600018049468336` precaricato

## Sviluppo locale

```bash
npm ci
npm run dev
```

## Controlli

```bash
npm run check
npm run lint
npm run build
```

Il deploy su GitHub Pages avviene automaticamente con il workflow presente in `.github/workflows/deploy-pages.yml` dopo ogni push sul branch `main`.
