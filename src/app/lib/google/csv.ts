export interface ParsedGscRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const isPercent = trimmed.endsWith("%");
  const numeric = Number(trimmed.replace(/[%,$]/g, "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return isPercent ? numeric / 100 : numeric;
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

export function parsePerformanceCsv(text: string): ParsedGscRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const keyIndex = Math.max(
    header.findIndex((cell) => cell === "top pages" || cell === "top queries"),
    0,
  );
  const clicksIndex = header.indexOf("clicks");
  const impressionsIndex = header.indexOf("impressions");
  const ctrIndex = header.indexOf("ctr");
  const positionIndex = header.indexOf("position");

  if (
    clicksIndex === -1 ||
    impressionsIndex === -1 ||
    ctrIndex === -1 ||
    positionIndex === -1
  ) {
    return [];
  }

  const seen = new Set<string>();
  const parsed: ParsedGscRow[] = [];

  for (const row of rows.slice(1)) {
    const key = (row[keyIndex] ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    parsed.push({
      key: key.slice(0, 1200),
      clicks: parseNumber(row[clicksIndex]),
      impressions: parseNumber(row[impressionsIndex]),
      ctr: parseNumber(row[ctrIndex]),
      position: parseNumber(row[positionIndex]),
    });
  }

  return parsed.slice(0, 2000);
}
