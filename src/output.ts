import type { OutputFormat } from "./types.js";

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function rowsFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : { value: item },
    );
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["objects", "items", "buckets", "profiles"]) {
      if (Array.isArray(object[key])) {
        return rowsFrom(object[key]);
      }
    }
    return [object];
  }
  return [{ value }];
}

function table(value: unknown): string {
  const rows = rowsFrom(value);
  if (rows.length === 0) {
    return "";
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const widths = columns.map((column) =>
    Math.max(
      column.length,
      ...rows.map((row) => stringifyCell(row[column]).length),
    ),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ");
  return [
    line(columns),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) =>
      line(columns.map((column) => stringifyCell(row[column]))),
    ),
  ].join("\n");
}

export function writeOutput(value: unknown, format: OutputFormat): void {
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(value, null, 2)}\n`
      : `${table(value)}\n`,
  );
}

export function writeError(
  error: { code: string; message: string; requestId?: string },
  format: OutputFormat,
): void {
  if (format === "json") {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.requestId ? { requestId: error.requestId } : {}),
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(
      `${error.code}: ${error.message}${error.requestId ? ` (requestId: ${error.requestId})` : ""}\n`,
    );
  }
}
