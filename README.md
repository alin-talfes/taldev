# TALDEV — Talfeș Development

Site-ul public TALDEV prezintă servicii de dezvoltare web, aplicații de business și automatizări. Repository-ul include și aplicația SAC PFA și demonstrații statice/interactiv-simulate.

**Site public:** https://alin-talfes.github.io/taldev/  
**Tehnologii principale:** HTML, CSS, JavaScript; pentru SAC PFA: Supabase Auth, Postgres și Storage.

## Structura repository-ului

```text
/
├── index.html                 # Pagina principală TALDEV
├── servicii/index.html        # Servicii, pachete și prețuri
├── despre/index.html          # Despre TALDEV
├── demo/index.html            # Catalog de demonstrații
├── demo/sacpfa/index.html     # Demo vizual SAC PFA, cu date fictive
├── demo/pontaj/index.html     # Demo interactiv pontaj, cu date fictive
├── demo/mru/index.html        # Demo interactiv MRU, cu date fictive
├── styles/style.css           # Stiluri pentru site-ul public
├── js/script.js               # Navigare, temă și animații
├── files/                     # Active publice și documente de prezentare
├── sac/                       # Aplicație SAC PFA conectată la Supabase
│   ├── js/                    # UI, API și servicii
│   ├── supabase/migrations/   # Migrații SQL versionate
│   ├── supabase/functions/    # Edge Functions
│   └── tests/                 # Teste Node.js
├── sitemap.xml
└── robots.txt
```

## Rulare locală

Pentru site-ul public, deschide repository-ul cu un server static (de exemplu VS Code Live Server). Un server HTTP local este preferabil deschiderii directe a fișierelor, deoarece paginile folosesc rute relative și unele module ES.

Pentru testele SAC PFA este necesar Node.js. Din directorul `sac/`:

```bash
npm test
npm run check
```

`npm test` execută suita Node.js (inclusiv testele de logică financiară, integritate și validare upload). `npm run check` verifică sintaxa fișierelor JavaScript din aplicația SAC.

## Aplicația SAC PFA

Aplicația din `/sac/` folosește Supabase pentru autentificare, persistența datelor și documente. Cheia publishable din client este publică prin natura arhitecturii browser; **nu introduce niciodată o cheie `service_role` sau o cheie secretă în fișierele livrate browserului**. Separarea datelor între utilizatori trebuie asigurată la nivelul bazei de date și Storage prin RLS/politici, nu doar prin controale din interfață.

Înainte de a utiliza SAC pentru documente sau evidențe reale, verifică în proiectul Supabase activ:
- starea și configurația bucket-ului `documents`, inclusiv limita de dimensiune și MIME types permise;
- politicile RLS pentru toate tabelele expuse și politicile de acces Storage;
- fluxurile de backup, retenție, export și recuperare;
- configurația autentificării, resetarea parolei și URL-urile de redirecționare.

Validarea din browser ajută la UX și reduce upload-urile accidentale, dar nu este o barieră de securitate suficientă singură. Restricțiile de tip și dimensiune trebuie configurate și verificate în Supabase Storage.

**Limitare:** SAC nu trebuie prezentat ca înlocuitor al verificării unui contabil și nu trebuie presupus că transmisiile ANAF/e-Factura au loc automat decât dacă există o integrare server-side activă, testată și documentată.

## Demo-uri

Elementele din `demo/` sunt construite pentru a prezenta interfețe și fluxuri. Folosește numai date fictive în demonstrații. Demo-urile MRU și pontaj sunt marcate `noindex`; ele nu sunt medii de lucru și nu trebuie utilizate pentru date reale despre angajați.

## SEO și indexare

Sitemap-ul include paginile publice de prezentare și catalogul demo. Pagina de autentificare SAC este marcată `noindex, nofollow` și exclusă din sitemap. Această setare ține pagina departe de rezultatele motoarelor de căutare, dar **nu protejează datele**; protecția reală se bazează pe autentificare, RLS și autorizarea Storage.

## Modificări și migrații

Păstrează modificările în ramuri de lucru și integrează-le prin Pull Request. Pentru schema Supabase, adaugă migrații noi și nu rescrie migrațiile istorice care au fost aplicate în producție. Rulează testele înainte de merge.

## Contact

- **Email:** [alin.talfes@outlook.com](mailto:alin.talfes@outlook.com)
- **Telefon:** [+40 770 823 386](tel:+40770823386)
- **WhatsApp:** [Contact TALDEV](https://wa.me/40770823386)
- **GitHub:** [alin-talfes](https://github.com/alin-talfes)
