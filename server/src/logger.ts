const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: Level = (process.env.LOG_LEVEL as Level) || "info";

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(level: string, tag: string, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `${ts} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}`;
  return data && Object.keys(data).length > 0 ? `${base} ${JSON.stringify(data)}` : base;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(tag: string): Logger {
  return {
    debug(msg, data?) { if (shouldLog("debug")) console.debug(format("debug", tag, msg, data)); },
    info(msg, data?)  { if (shouldLog("info"))  console.log(format("info", tag, msg, data)); },
    warn(msg, data?)  { if (shouldLog("warn"))  console.warn(format("warn", tag, msg, data)); },
    error(msg, data?) { if (shouldLog("error")) console.error(format("error", tag, msg, data)); },
  };
}
