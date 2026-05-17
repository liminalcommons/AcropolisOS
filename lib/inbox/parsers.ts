import YAML from "yaml";

export type InboxPayload = Record<string, unknown>;

export function parseCsv(input: string): InboxPayload[] {
  const records = parseCsvRecords(input);
  if (records.length === 0) return [];
  const header = records[0];
  return records.slice(1).map((row) => {
    const obj: InboxPayload = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = row[i] ?? "";
    }
    return obj;
  });
}

function parseCsvRecords(input: string): string[][] {
  const out: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") out.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") out.push(row);
  }
  return out;
}

export function parseJson(input: string): InboxPayload[] {
  const parsed: unknown = JSON.parse(input);
  if (Array.isArray(parsed)) {
    return parsed.map((el) => toPayload(el));
  }
  return [toPayload(parsed)];
}

function toPayload(v: unknown): InboxPayload {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as InboxPayload;
  }
  return { value: v };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?/;

export function parseMarkdown(input: string): InboxPayload[] {
  const match = input.match(FRONTMATTER_RE);
  if (!match) {
    return [{ frontmatter: {}, body: input }];
  }
  const fmRaw = match[1].trim();
  const fm = fmRaw.length === 0 ? {} : YAML.parse(fmRaw);
  const body = input.slice(match[0].length);
  return [
    {
      frontmatter: (fm ?? {}) as InboxPayload,
      body,
    },
  ];
}

export interface ParseInput {
  mime: string;
  filename: string;
  contents: string;
}

export function parsePayload(input: ParseInput): InboxPayload[] {
  const kind = detectKind(input.mime, input.filename);
  switch (kind) {
    case "csv":
      return parseCsv(input.contents);
    case "json":
      return parseJson(input.contents);
    case "markdown":
      return parseMarkdown(input.contents);
    default:
      throw new Error(
        `unsupported type: mime=${input.mime} filename=${input.filename}`,
      );
  }
}

function detectKind(
  mime: string,
  filename: string,
): "csv" | "json" | "markdown" | null {
  const m = mime.toLowerCase();
  if (m === "text/csv" || m === "application/csv") return "csv";
  if (m === "application/json" || m === "text/json") return "json";
  if (m === "text/markdown" || m === "text/x-markdown") return "markdown";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "markdown") return "markdown";
  return null;
}
