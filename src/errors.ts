export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    options: { exitCode?: number; requestId?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    if (options.requestId) {
      this.requestId = options.requestId;
    }
  }
}

const KEY_VALUE_SECRET =
  /((?:access[_-]?key|secret[_-]?access[_-]?key|security[_-]?token|password)\s*[:=]\s*)[^\s,;"']+/gi;

export function maskSensitiveText(value: unknown, secrets: string[] = []): string {
  let text = value instanceof Error ? value.message : String(value);
  text = text.replace(KEY_VALUE_SECRET, "$1***");
  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join("***");
    }
  }
  return text;
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  return new CliError("UNEXPECTED_ERROR", maskSensitiveText(error), {
    cause: error,
  });
}
