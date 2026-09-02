# Supabase

Acest director păstrează sursa funcției Edge și istoricul SQL al proiectului Supabase
`bqwwjnorzgoaksxfkixo`.

## Migrații

Cele 27 de fișiere din `migrations/` sunt exportate din
`supabase_migrations.schema_migrations` și folosesc exact versiunile, numele și
instrucțiunile SQL aplicate în proiectul de producție. Orice schimbare viitoare de
schemă trebuie adăugată ca migrație nouă și aplicată cu Supabase CLI sau prin
instrumentul de migrare Supabase; fișierele istorice nu se editează retroactiv.

Istoricul recuperat începe după crearea schemei inițiale. Din acest motiv, el este
sursa de adevăr pentru evoluția proiectului existent, dar nu reprezintă singur un
bootstrap complet pentru o bază goală. Pentru clonarea într-un proiect nou se
exportă mai întâi schema curentă cu `supabase db dump`, apoi se păstrează separat
migrațiile ulterioare.

## Edge Function

Codul funcției `bnr-rate` se află în `functions/bnr-rate/index.ts`. În producție
funcția validează JWT-ul și returnează cursul BNR pentru EUR sau USD la data
operațiunii (ori ultima zi bancară disponibilă).
