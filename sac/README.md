# Ghid complet de utilizare PFA Admin

**Versiunea aplicației:** PFA Admin v1.0
**Pentru:** titular PFA, fără studii economice
**Scop:** gestionezi singur facturile, încasările, plățile, cheltuielile, activele și situația fiscală, fără să fii contabil.

---

## Cuprins

1. [Ce face PFA Admin?](#1-ce-face-pfa-admin)
2. [Cum intri în aplicație](#2-cum-intri-în-aplicație)
3. [Ce vezi pe ecranul principal](#3-ce-vezi-pe-ecranul-principal)
4. [Dashboard – informațiile importante](#4-dashboard--informațiile-importante)
5. [Configurare – datele PFA-ului tău](#5-configurare--datele-pfa-ului-tău)
6. [Clienți](#6-clienți)
7. [Furnizori](#7-furnizori)
8. [Serii de facturare](#8-serii-de-facturare)
9. [Serii de proforme](#9-serii-de-proforme)
10. [Facturi emise](#10-facturi-emise)
11. [Proforme](#11-proforme)
12. [Facturi primite](#12-facturi-primite)
13. [Alte încasări / cheltuieli](#13-alte-încasări--cheltuieli)
14. [Aport propriu](#14-aport-propriu)
15. [Registrul-jurnal de încasări și plăți (RJIP)](#15-registrul-jurnal-de-încasări-și-plăți-rjip)
16. [Registru-inventar](#16-registru-inventar)
17. [Mijloace fixe](#17-mijloace-fixe)
18. [Documente](#18-documente)
19. [Rapoarte](#19-rapoarte)
20. [Situație fiscală](#20-situație-fiscală)
21. [Conturi bancare](#21-conturi-bancare)
22. [Resetare parolă](#22-resetare-parolă)
23. [Recomandări practice lunare](#23-recomandări-practice-lunare)
24. [Întrebări frecvente](#24-întrebări-frecvente)

---

## 1. Ce face PFA Admin?

PFA Admin este o aplicație web care te ajută să ții evidența activității tale ca Persoană Fizică Autorizată.

Aplicația:

- Creează facturi emise către clienți.
- Înregistrează facturi primite de la furnizori.
- Urmărește încasările și plățile.
- Calculează veniturile și cheltuielile fiscale.
- Generează un registru-jurnal (RJIP).
- Te ajută să vezi ce bani intră și ce bani ies.
- Păstrează documentele justificative atașate.

> **Important:** aplicația nu transmite automat facturi la ANAF și nu oferă consultanță fiscală. Ea organizează datele ca tu să le ai la îndemână.

---

## 2. Cum intri în aplicație

1. Deschide browserul (Chrome, Firefox, Edge, Safari).
2. Accesează adresa unde este publicată aplicația.
3. Introdu emailul și parola.
4. Apasă **Autentificare**.

### Dacă ai uitat parola:

- Apasă **Ai uitat parola?**
- Introdu emailul.
- Primești un link pe email.
- Urmează linkul și setează o parolă nouă.

---

## 3. Ce vezi pe ecranul principal

După autentificare, aplicația are:

- **Meniu lateral** (stânga) – toate secțiunile aplicației.
- **Zona centrală** – conținutul secțiunii curente.
- **Buton hamburger** (mobil) – deschide meniul pe telefon.

### Meniu:

- Dashboard
- Facturi emise
- Facturi primite
- Proforme
- Alte încasări / cheltuieli
- Clienți
- Furnizori
- RJIP
- Inventar
- Mijloace fixe
- Aport propriu
- Documente
- Rapoarte
- Situație fiscală
- Configurare

---

## 4. Dashboard – informațiile importante

Dashboard-ul este prima pagină. Aici vezi un rezumat rapid:

- **Încasări operaționale luna curentă** – bani intrați din activitate.
- **Plăți operaționale luna curentă** – bani ieșiți pentru activitate.
- **Sold cash-flow operațional** – diferența dintre intrări și ieșiri.
- **Facturi emise neachitate** – câți bani mai ai de primit.
- **Facturi primite neachitate** – câți bani mai ai de plătit.
- **Facturi restante** – facturi emise care au depășit scadența.
- **Total mijloace fixe** – valoarea activelor tale.
- **Alerte mijloace fixe** – dacă ceva lipsește, ex. număr de inventar.

Butonul **Reîncarcă** actualizează datele.

---

## 5. Configurare – datele PFA-ului tău

Intră în **Configurare**. Aici ai mai multe file:

### Date generale

- **Denumire PFA** – ex: „Talfeș Remus Alin PFA".
- **Titular** – numele tău complet.
- **Identificator fiscal (CUI/CNP)** – codul tău fiscal.
- **Registrul Comerțului** – numărul de înregistrare.
- **Adresă, județ, localitate, telefon, email** – datele tale.
- **Logo** – aplicația folosește automat imaginea standard `files/header.png`.
- **Text subsol factură** – un mesaj scurt care apare jos pe factură.

Apasă **Salvează**.

### Date fiscale

- **Regim fiscal** – de obicei „Sistem real" pentru PFA.
- **Statut TVA** – alege ce se potrivește (neînregistrat, înregistrat, scutit).
- **Cota TVA implicită** – ex: 19, dacă ai TVA.
- **Monedă implicită** – RON.
- **Termen de plată implicit** – ex: 14 zile.

Apasă **Salvează**.

### Conturi bancare

- Adaugă conturile bancare ale PFA-ului.
- IBAN, bancă, monedă.
- Poți bifa **Cont implicit**.

### Serii facturare / Serii proforme

- Serii pentru facturi emise: ex. „FCT".
- Serii pentru proforme: ex. „PROF".
- Fiecare serie are un an și un număr următor.
- Aplicația numără automat documentele emise.

---

## 6. Clienți

Aici ții evidența clienților cărora le vinzi.

### Adăugare client

1. Intră în **Clienți**.
2. Apasă **Adaugă client**.
3. Completează:
   - Denumire legală – numele firmei sau persoanei.
   - Nume comercial – opțional.
   - Identificator fiscal (CUI/CNP).
   - Cod TVA, dacă există.
   - Județ, localitate, adresă.
   - Email, telefon.
   - IBAN, opțional.
   - Note.
4. Apasă **Adaugă**.

### Editare / dezactivare

- **Editează** – modifică datele clientului.
- **Dezactivează / Activează** – ascunde sau afișează clientul în liste.

---

## 7. Furnizori

La fel ca la clienți, dar pentru firmele de la care cumperi.

---

## 8. Serii de facturare

1. Intră în **Configurare → Serii facturare**.
2. Apasă **Adaugă serie**.
3. Introdu:
   - Seria – ex. „FCT".
   - Anul – 2026.
   - Număr următor – 1.
4. Bifează **Activă**.
5. Apasă **Adaugă**.

Aplicația va folosi această serie la emiterea facturilor.

---

## 9. Serii de proforme

La fel ca la facturi, dar pentru proforme. Ex. „PROF", anul curent, număr 1.

---

## 10. Facturi emise

Aici creezi facturile pe care le trimiți clienților.

### Creare factură

1. Intră în **Facturi emise**.
2. Apasă **Creează factură**.
3. Alege clientul.
4. Vei vedea seria și următorul număr automat (doar informativ).
5. Alege data emiterii și data scadenței.
6. Alege moneda și termenul de plată.
7. Adaugă linii:
   - Descriere serviciu/produs.
   - Cantitate.
   - UM (buc, ore).
   - Preț unitar.
   - Discount, dacă e cazul.
   - TVA % (dacă nu ești plătitor, 0).
8. Apasă **Creează draft**.

Factura va fi salvată ca draft.

### Emitere factură

1. În lista de facturi, găsește draft-ul.
2. Apasă **Emite**.
3. Confirmă.

Aplicația alocă automat seria și numărul oficial.

### Încasare factură

După ce clientul plătește:

1. Găsește factura emisă.
2. Apasă **Încasează**.
3. Introdu suma încasată, data, metoda.
4. Apasă **Înregistrează încasarea**.

Factura devine „Achitată".

### Previzualizare și salvare PDF

1. Apasă **Previzualizare** lângă factura dorită.
2. Verifică datele furnizorului, clientului, pozițiile, TVA-ul și totalurile.
3. Apasă **Tipărește / Salvează PDF**.
4. În fereastra browserului poți alege imprimanta sau opțiunea de salvare ca PDF.

Pentru facturile achitate parțial, documentul afișează separat totalul, suma achitată și soldul rămas.

### Storno / corecție

Dacă greșești o factură:

1. Găsește factura emisă.
2. Apasă **Storno**.
3. Confirmă.

Se creează un document de storno legat de factura originală. Originalul rămâne în evidență.

### Ștergere draft

Doar facturile cu statut **Draft** pot fi șterse.

1. Găsește draft-ul.
2. Apasă **Șterge**.
3. Confirmă.

---

## 11. Proforme

O proformă este o factură provizorie, înainte de factura finală.

### Creare proformă

1. Intră în **Proforme**.
2. Apasă **Creează proformă**.
3. Alege clientul.
4. Vei vedea seria și numărul care se va aloca la emitere.
5. Completează data, scadența, moneda, termen plată.
6. Adaugă liniile.
7. Apasă **Creează draft**.

### Emitere proformă

Apasă **Emite**. Seria și numărul sunt alocate automat.

### Conversie la factură

Dacă clientul acceptă proforma:

1. Găsește proforma emisă.
2. Apasă **Convertește la factură**.
3. Se creează un draft de factură pe baza ei.
4. Du-te la **Facturi emise**, editează dacă e nevoie, apoi emite.

Pentru verificare, tipărire sau salvare PDF, apasă **Previzualizare** lângă proforma dorită.

---

## 12. Facturi primite

Aici înregistrezi facturile pe care le primești de la furnizori.

### Adăugare factură primită

1. Intră în **Facturi primite**.
2. Apasă **Adaugă factură primită**.
3. Alege furnizorul.
4. Introdu seria și numărul facturii primite.
5. Alege data documentului și scadența.
6. Alege moneda, categoria, deductibilitatea.
7. Adaugă liniile facturii.
8. Apasă **Adaugă**.

### Confirmare

După ce ai verificat factura, apasă **Confirmă**.
După confirmare, nu mai poate fi editată.

### Plată

După ce plătești factura:

1. Apasă **Înregistrează plată**.
2. Introdu suma, data, metoda.
3. Apasă **Înregistrează plata**.

### Storno

Dacă furnizorul emite storno:

1. Apasă **Storno** pe factura confirmată.
2. Introdu seria și numărul documentului de storno.
3. Alege data.
4. Apasă **Înregistrează storno**.

Factura originală devine anulată automat, iar storno-ul are valori negative.

### Deductibilitate

- **Necesită verificare** – nu știi încă dacă se deduce.
- **Deductibil** – scade venitul impozabil.
- **Parțial deductibil** – o parte se deduce; poți seta procent și limită.
- **Nedeductibil** – nu scade venitul impozabil.

---

## 13. Alte încasări / cheltuieli

Aici adaugi mișcările de bani care nu au factură.

### Exemple:

- Alte venituri (ex. subvenții).
- Restituiri.
- Consumabile.
- Servicii.
- Transport.
- Taxe și impozite.
- Comisioane bancare.
- Echipamente.
- Alte cheltuieli.

### Adăugare operațiune

1. Intră în **Alte încasări / cheltuieli**.
2. Apasă **Adaugă operațiune**.
3. Alege:
   - Tip: Încasare sau Cheltuială.
   - Sumă, monedă, data.
   - Metodă plată.
   - Cont bancar, dacă e cazul.
   - Categorie.
   - Tratament fiscal: venit, cheltuială deductibilă, cheltuială nedeductibilă, mișcare numerar.
   - Deductibilitate limitată (procent / limită) dacă este parțial.
   - Descriere.
   - Document justificativ: tip, număr, dată.
   - Partener, referință, observații.
4. Apasă **Adaugă**.

### Anulare

Dacă ai greșit, apasă **Anulează**. Operațiunea rămâne în listă cu statut anulat, dar nu mai afectează calculul fiscal.

---

## 14. Aport propriu

Aici înregistrezi banii pe care îi aduci din banii personali în contul PFA sau invers.

### Adăugare aport

1. Intră în **Aport propriu**.
2. Apasă **Adaugă aport**.
3. Introdu suma, data, metoda, contul.
4. Descriere: ex. „Aport propriu titular".
5. Apasă **Adaugă aport**.

### Restituire aport

Apasă **Restituie aport** și completează similar.

> Aceste sume nu sunt venituri sau cheltuieli fiscale; ele apar în RJIP doar ca mișcări de bani.

---

## 15. Registrul-jurnal de încasări și plăți (RJIP)

Intră în **RJIP**. Vezi toate încasările și plățile, pe perioade.

Poți filtra:

- După perioadă.
- Direcție (încasări / plăți).
- Metodă de plată.
- Monedă.
- Căutare text.

Poți **Printează / PDF** sau **Export CSV**.

---

## 16. Registru-inventar

Aici ții evidența obiectelor de inventar.

### Adăugare element

1. Intră în **Inventar**.
2. Apasă **Adaugă element**.
3. Introdu data, descriere, document referință, cantitate, valoare unitară, sursă, locație, status.
4. Apasă **Adaugă**.

Aplicația generează automat număr de inventar.

---

## 17. Mijloace fixe

Mijloacele fixe sunt bunuri cu durată lungă: laptop, monitor, imprimantă.

### Adăugare mijloc fix

1. Intră în **Mijloace fixe**.
2. Apasă **Adaugă mijloc fix**.
3. Completează nume, data achiziție, valoare, categorie, serie, locație, responsabil.
4. Dacă se amortizează:
   - Metoda: liniară.
   - Durata de viață (luni).
   - Data începerii amortizării.
5. Apasă **Adaugă**.

### Număr inventar

Aplicația generează număr de inventar automat.

### Amortizare

Apasă **Amortizare** pentru a înregistra amortizarea lunară.

---

## 18. Documente

Aici încarci și păstrezi documente justificative:

- Facturi PDF.
- Chitanțe.
- Extrase bancare.
- Contracte.

### Încărcare document

1. Intră în **Documente**.
2. Apasă **Încarcă document**.
3. Alege fișierul.
4. Poți asocia cu o entitate (factură, client, furnizor, etc.).
5. Apasă **Încarcă**.

### Descărcare / ștergere

Butoanele **Descarcă** și **Șterge** apar în listă.

---

## 19. Rapoarte

Intră în **Rapoarte**. Acolo vezi diverse situații:

- **Facturare** – facturi emise și primite, solduri.
- **Documente** – ultimele documente încărcate.
- **Mijloace fixe** – sumar, registru inventar, amortizare, fișe active.
- **Numere inventar** – lista numerelor generate.

Poți exporta CSV sau printa.

---

## 20. Situație fiscală

Aici vezi un rezumat pentru anul curent:

- Venituri.
- Cheltuieli deductibile.
- Cheltuieli nedeductibile.
- Aporturi.
- Retrageri.
- Venit net estimat.

Selectează anul din listă și apasă **Print / PDF** pentru un raport.

---

## 21. Conturi bancare

În **Configurare → Conturi bancare** adaugi conturile PFA-ului:

- IBAN.
- Bancă.
- Monedă.
- Cont implicit.

Aceste conturi apar la încasări, plăți și operațiuni manuale.

---

## 22. Resetare parolă

Pe ecranul de login, apasă **Ai uitat parola?** și urmează pașii.

---

## 23. Recomandări practice lunare

1. **Începutul lunii:** verifică facturile emise neîncasate.
2. Pe măsură ce lucrezi, creează facturi și proforme.
3. Când primești bani, înregistrează încasarea.
4. Când primești facturi, adaugă-le în Facturi primite.
5. Confirmă facturile primite după verificare.
6. Când plătești, înregistrează plata.
7. La final de lună, verifică RJIP și Situația fiscală.
8. Păstrează documentele încărcate în Documente.

---

## 24. Întrebări frecvente

**Întrebare:** Factura emisă este automat și venit?
**Răspuns:** Nu. Venitul se înregistrează la încasare. Până atunci, factura este o creanță.

**Întrebare:** Aportul titular este venit?
**Răspuns:** Nu. Aportul apare în RJIP, dar nu este venit fiscal.

**Întrebare:** Pot șterge o factură emisă?
**Răspuns:** Nu. Facturile emise nu se șterg. Se pot storna.

**Întrebare:** Ce înseamnă deductibilitate?
**Răspuns:** Cheltuielile deductibile reduc suma pe care plătești impozit. Cele nedeductibile nu reduc.

**Întrebare:** Ce fac cu o factură primită în valută?
**Răspuns:** Momentan înregistrezi suma și moneda. Pentru evaluare fiscală în lei, vei folosi cursul BNR corespunzător – această facilitate va fi adăugată ulterior.
