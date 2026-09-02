import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function parseRateFromXml(xml: string, currency: string, beforeDate: string) {
  const cubes = [...xml.matchAll(/<Cube\s+date=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Cube>/gi)]
    .map((match) => ({ date: match[1], body: match[2] }))
    .filter((entry) => entry.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const cube of cubes) {
    for (const match of cube.body.matchAll(/<Rate\s+([^>]*?)>([^<]+)<\/Rate>/gi)) {
      const attrs = match[1];
      const code = attrs.match(/currency=["']([A-Z]{3})["']/i)?.[1]?.toUpperCase();
      if (code !== currency) continue;
      const multiplierRaw = attrs.match(/multiplier=["'](\d+)["']/i)?.[1];
      const multiplier = multiplierRaw ? Number(multiplierRaw) : 1;
      const quoted = Number(String(match[2]).trim().replace(",", "."));
      if (!Number.isFinite(quoted) || quoted <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) continue;
      return { rate: quoted / multiplier, rateDate: cube.date };
    }
  }
  return null;
}

async function loadYear(year: number) {
  const urls = [
    `https://curs.bnr.ro/files/xml/years/nbrfxrates${year}.xml`,
    `https://www.bnr.ro/files/xml/years/nbrfxrates${year}.xml`,
    `https://bnr.ro/files/xml/years/nbrfxrates${year}.xml`,
  ];
  let lastError = "BNR indisponibil";
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "TALDEV-PFA/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        lastError = `BNR HTTP ${response.status}`;
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();
    const currency = String(payload?.currency || "").trim().toUpperCase();
    const operationDate = String(payload?.operation_date || payload?.date || "").trim();

    if (!/^[A-Z]{3}$/.test(currency) || currency === "RON") {
      return json({ error: "Monedă invalidă pentru curs BNR" }, 400);
    }
    if (!validIsoDate(operationDate)) {
      return json({ error: "Data operațiunii este invalidă" }, 400);
    }

    const year = Number(operationDate.slice(0, 4));
    let lastError: unknown = null;
    for (const candidateYear of [year, year - 1]) {
      try {
        const xml = await loadYear(candidateYear);
        const result = parseRateFromXml(xml, currency, operationDate);
        if (result) {
          return json({
            currency,
            operation_date: operationDate,
            rate: Number(result.rate.toFixed(6)),
            rate_date: result.rateDate,
            source: "BNR",
          });
        }
      } catch (error) {
        lastError = error;
      }
    }

    const suffix = lastError instanceof Error ? ` (${lastError.message})` : "";
    return json({ error: `Nu există curs BNR ${currency} anterior datei ${operationDate}${suffix}` }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Eroare la preluarea cursului BNR" }, 500);
  }
});
