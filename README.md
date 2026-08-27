# TALDEV — Site de prezentare

Site de prezentare pentru **TALDEV — Talfeș Development**, un proiect independent de dezvoltare web.
Construit cu HTML, CSS și JavaScript vanilla, fără dependențe externe.  
Scopul este de a prezenta serviciile, procesul de lucru, pachetele și datele de contact.

---

## Cuprins

- [Prezentare generală](#prezentare-generală)
- [Tehnologii folosite](#tehnologii-folosite)
- [Structura fișierelor](#structura-fișierelor)
- [Instalare și rulare](#instalare-și-rulare)
- [Detalii HTML](#detalii-html)
- [Detalii CSS](#detalii-css)
- [Detalii JavaScript](#detalii-javascript)
- [Personalizare](#personalizare)
- [Optimizare SEO](#optimizare-seo)
- [Accesibilitate](#accesibilitate)
- [Contact](#contact)

---

## Prezentare generală

Site-ul este o pagină de tip one-page, cu navigare prin ancore, design responsive și animații discrete.  
Este construit ca un site static, ușor de găzduit pe orice serviciu (Netlify, Vercel, GitHub Pages, hosting simplu).

Mesajul principal este: **Site-uri. Aplicații. Automatizări.**

---

## Tehnologii folosite

- **HTML5** – structură semantică
- **CSS3** – stilizare, variabile, Flexbox, Grid, animații
- **JavaScript (ES6)** – interactivitate, animații, observatori
- **Google Fonts** – Poppins, Inter, JetBrains Mono
- **Fără framework-uri externe**

---

## Structura fișierelor

```text
/ (root)
│
├── index.html
├── favicon.svg
├── demo/
│   └── sacpfa.html
│
├── styles/
│   └── style.css
│
├── js/
│   └── script.js
│
└── files/
    ├── cert.pdf
    ├── cv.pdf
    ├── header.png
    └── studii.pdf
```

---

## Instalare și rulare

1. Clonează repository-ul:
   ```bash
   git clone https://github.com/alin-talfes/taldev-site.git
   ```
2. Deschide `index.html` direct în browser sau folosește un server local (ex: Live Server în VS Code).
3. Nu necesită build, dependențe sau configurare.

---

## Detalii HTML

### Head și meta

- `meta description` – descriere pentru motoare de căutare.
- `meta author` – TALFEȘ REMUS-ALIN P.F.A.
- `meta keywords` – cuvinte cheie relevante.
- `title` – „TALDEV - Talfeș Development”
- `link favicon` – `favicon.svg` (iconiță `<t>` pe fundal bleumarin).
- `preconnect` și `link` către Google Fonts (Poppins, Inter, JetBrains Mono).
- `script type="application/ld+json"` – date structurate `ProfessionalService` cu oferte.

### Header și navigare

- `header#navbar` – sticky, cu backdrop blur.
- Folosește logo-ul oficial din `files/header.png`.
- Include comutator accesibil pentru tema luminoasă/întunecată.
- Buton hamburger (`button#navToggle`) pentru mobil.
- Meniul (`nav#navMenu`) cu linkuri către: `#servicii`, `#pentru-cine`, `#cum-lucram`, `#pachete`, `#contact`.
- Fără buton WhatsApp în header (există doar butonul plutitor).

### Hero

- `h1#typing-title` – textul „Site-uri. Aplicații. Automatizări.” este animat doar când utilizatorul nu preferă mișcare redusă.
- `p.hero-text` – descriere scurtă.
- `div.hero-actions` – butoane CTA: „Solicită o ofertă” (contact) și „Vezi serviciile” (servicii).
- `div.hero-note` – notă despre Talfeș Development.

### Servicii

- Secțiune `section#servicii` cu grid de 6 carduri:
  - Site-uri profesionale
  - Aplicații web
  - Automatizări & integrări
  - Magazine online custom
  - Design & branding
  - Mentenanță & suport

### Pentru cine

- Secțiune `section#pentru-cine` cu 6 carduri:
  - Firme mici
  - Profesioniști independenți
  - Servicii locale
  - Antreprenori
  - Afaceri care doresc automatizare
  - Proiecte noi

### Cum lucrăm

- Secțiune `section#cum-lucram` cu 5 pași.
- Fiecare pas conține:
  - `span.step-number` – număr 1-5
  - `h3` – titlul pasului
  - `p` – descriere
- Numărul și titlul sunt pe același rând (flex).

### Pachete

- Secțiune `section#pachete` cu 3 carduri:
  - Site Start – de la 1.490 lei
  - Site Business – de la 2.990 lei
  - Aplicație web Custom – de la 4.990 lei
- Fiecare card conține listă de caracteristici și buton „Solicită ofertă”.

### Servicii suplimentare

- Automatizări – de la 590 lei.
- Design & branding – de la 390 lei.
- Mentenanță – de la 149 lei/lună.
- Dezvoltare și consultanță – 120 lei/oră.

### Ce este inclus

- Secțiune `section#ce-este-inclus` cu 6 itemi:
  - Design responsive
  - Performanță și accesibilitate
  - Testare înainte de lansare
  - SEO tehnic de bază
  - Configurare funcționalități
  - Predarea accesurilor
- Notă despre costuri suplimentare.

### Demo S.A.C. - P.F.A.

- Secțiunea `section#demo` prezintă proiectul demonstrativ.
- `demo/sacpfa.html` conține dashboardul vizual al Sistemului de Administrare și Contabilitate al Persoanei Fizice Autorizate.
- Datele din demonstrație sunt fictive, iar controalele nu execută operațiuni.

### De ce Talfeș Development

- Secțiune `section#de-ce` cu 4 carduri:
  - Prețuri transparente
  - Soluții adaptate
  - Comunicare directă
  - Fără complexitate inutilă

### Educație și certificare

- Secțiune `section#educatie-certificare`.
- Card alb cu două grupuri separate printr-o linie:
  - **Grup 1 – Educație**: licență, bacalaureat, curs formator + linkuri PDF.
  - **Grup 2 – Certificare**: MTA HTML5 + link PDF.

### Contact

- Secțiune `section#contact`.
- Titlu „Ai un proiect?” și descriere.
- Butoane: WhatsApp (verde) și Email (bleumarin).

### Footer

- Fundal bleumarin închis.
- Logo TALDEV + descriere.
- Date PFA și CUI.
- Linkuri către WhatsApp, Email, GitHub.
- Text copyright.

### Butoane flotante

- `a.whatsapp-float` – buton rotund WhatsApp, fix în colțul dreapta-jos.
- `button#backToTop` – buton „înapoi sus”, apare după 400px scroll.

---

## Detalii CSS

### Variabile globale

Sunt definite în `:root`:

```css
--bg-start: #F4F8FA;
--bg-end: #E9F2F6;
--bg-card: #FFFFFF;
--text-primary: #0A2540;
--text-secondary: rgba(10,37,64,0.7);
--text-muted: rgba(10,37,64,0.5);
--accent: #00C2CB;
--accent-hover: #00A8AF;
--accent-rgb: 0,194,203;
--border-light: rgba(10,37,64,0.1);
--shadow-sm: 0 2px 8px rgba(10,37,64,0.05);
--shadow-md: 0 8px 24px rgba(10,37,64,0.08);
--transition: 0.3s ease;
--border-radius: 20px;
--border-radius-sm: 12px;
--font-heading: 'Poppins', sans-serif;
--font-body: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

Culorile respectă paleta logo-ului: bleumarin închis (#0A2540) și turcoaz deschis (#00C2CB).

### Clase comune

- `.container` – centrat, max-width 900px.
- `.section` – padding vertical 40px.
- `.section-title` – cu bară accent înainte.
- `.section-subtitle` – text secundar.

### Stilizarea butoanelor

Toate butoanele folosesc clasa `.btn` cu:

- border-radius: 999px (formă de pilulă)
- border: 2px solid transparent
- tranziție la hover

Variante:

- `.btn-primary` – fundal turcoaz, text alb, border bleumarin.
- `.btn-secondary` – transparent, text bleumarin, border bleumarin.
- `.btn-whatsapp` – fundal verde WhatsApp, border bleumarin.
- `.btn-email` – fundal bleumarin, text alb, border turcoaz.

### Stilizarea cardurilor

Toate cardurile (`.service-card`, `.pricing-card`, `.audience-item`, `.included-item`, `.why-item`, `.process-step`, `.cert-small`) au:

- fundal alb (`--bg-card`)
- border: 2px solid `--accent` (turcoaz)
- border-radius: `--border-radius` (20px)
- box-shadow: `--shadow-md`

Aceasta asigură un design uniform.

### Animații

- `@keyframes blink` – cursorul de la animația de scriere.
- `.reveal` – fade + translateY pentru apariția elementelor.
- `.reveal.visible` – starea finală.

### Responsive

- Puncte de breakpoint: 640px, 900px, 639px.
- Pe mobil, meniul devine hamburger, gridurile se rearanjează.
- Logo-ul se micșorează pe ecrane mici.

---

## Detalii JavaScript

### Animația de scriere

- La încărcare, elementul `#typing-title` este scris caracter cu caracter (42ms per caracter), exceptând utilizatorii care preferă mișcare redusă.
- Cursorul intermitent este adăugat prin CSS `::after`.

### Meniu mobil

- `navToggle` deschide/închide meniul.
- Se închide la click pe un link sau în afara meniului.
- Atributul `aria-expanded` este actualizat pentru accesibilitate.

### Link activ

- Folosește `IntersectionObserver` pentru a evidenția link-ul corespunzător secțiunii vizibile.
- Clasa `.active` este aplicată link-ului activ.

### Animații reveal

- Toate elementele cu clasa `.reveal` sunt observate.
- Când intră în viewport (threshold 0.15), li se adaugă `.visible` și nu mai sunt observate.

### Buton back-to-top

- Apare după 400px scroll.
- La click, derulează lin în sus.

---

## Personalizare

### Culori

Modifică variabilele din `:root` în `styles/style.css` pentru a schimba paleta.

Exemplu:

```css
--accent: #ff6600;
--text-primary: #222222;
```

### Fonturi

Fonturile sunt încărcate din Google Fonts. Poți schimba importul în `index.html` și variabilele `--font-heading`, `--font-body`, `--font-mono`.

### Texte și conținut

Toate textele sunt direct în `index.html`. Caută secțiunile corespunzătoare și editează.

### Fișiere PDF

Linkurile din secțiunea „Educație și certificare” indică:

- `files/studii.pdf`
- `files/cv.pdf`
- `files/cert.pdf`

Asigură-te că aceste fișiere există în directorul `files/`.

---

## Optimizare SEO

- Meta description și keywords.
- Date structurate JSON-LD (`ProfessionalService`).
- Titluri ierarhice corecte.
- Text alternativ pentru logo (`aria-label`).
- Linkuri externe cu `rel="noopener"`.

---

## Accesibilitate

- Focus vizibil personalizat.
- Atribut `aria-expanded` pentru meniul mobil.
- `aria-label` pentru butoanele flotante.
- Suport complet `prefers-reduced-motion`.
- Contrast îmbunătățit pentru butoane și linkuri.
- Meniul mobil poate fi închis cu tasta Escape.

---

## Contact

- **WhatsApp**: [wa.me/alin.talfes](https://wa.me/alin.talfes)
- **Telefon**: [+40 770 823 386](tel:+40770823386)
- **Email**: [alin.talfes@outlook.com](mailto:alin.talfes@outlook.com)
- **GitHub**: [github.com/alin-talfes](https://github.com/alin-talfes)
