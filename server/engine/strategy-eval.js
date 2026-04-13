import { rsi, ema, sma, macd, bollinger } from "@/lib/indicators";

function compare(op, left, right) {
  switch (op) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "==":
      return left === right;
    default:
      return false;
  }
}

function lastDefined(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null && !Number.isNaN(arr[i])) return { i, v: arr[i] };
  }
  return null;
}

/**
 * Evaluate one rule against the last closed bar (index n-1).
 * @param {object} rule - { indicator, operator?, value, period?, fast?, slow?, ... }
 * @param {{ closes: number[], highs: number[], lows: number[] }} series
 */
export function evaluateRule(rule, series) {
  const { closes, highs, lows } = series;
  const n = closes.length;
  if (n < 3) return false;

  const ind = String(rule.indicator || "").toUpperCase();
  const period = rule.period ?? 14;
  const fast = rule.fast ?? 9;
  const slow = rule.slow ?? 21;

  if (ind === "RSI") {
    const arr = rsi(closes, period);
    const ld = lastDefined(arr);
    if (!ld) return false;
    return compare(rule.operator || "<", ld.v, Number(rule.value));
  }

  if (ind === "EMA_CROSS") {
    const eF = ema(closes, fast);
    const eS = ema(closes, slow);
    if (n < 2) return false;
    const i = n - 1;
    const prev = i - 1;
    if (eF[i] == null || eS[i] == null || eF[prev] == null || eS[prev] == null) {
      return false;
    }
    const bullNow = eF[i] > eS[i];
    const bullPrev = eF[prev] > eS[prev];
    const want = String(rule.value).toUpperCase();
    const mode = String(rule.mode || "").toLowerCase();

    // Compatibilitate: dacă `mode` cere explicit cross, păstrăm comportamentul strict.
    if (mode === "cross" || mode === "strict_cross" || want === "BULLISH_CROSS") {
      return bullNow && !bullPrev;
    }
    if (mode === "cross_down" || want === "BEARISH_CROSS") {
      return !bullNow && bullPrev;
    }

    // Mod implicit mai permisiv: trend state (nu doar bara exactă de cross).
    if (want === "BULLISH" || mode === "state" || mode === "state_bullish") {
      return bullNow;
    }
    if (want === "BEARISH" || mode === "state_bearish") {
      return !bullNow;
    }
    return bullNow;
  }

  if (ind === "SMA") {
    const arr = sma(closes, period);
    const ld = lastDefined(arr);
    if (!ld) return false;
    const price = closes[ld.i];
    return compare(rule.operator || ">", price, ld.v);
  }

  if (ind === "EMA") {
    const arr = ema(closes, period);
    const ld = lastDefined(arr);
    if (!ld) return false;
    const price = closes[ld.i];
    return compare(rule.operator || ">", price, ld.v);
  }

  if (ind === "MACD") {
    const { line, signal, histogram } = macd(closes, rule.fast ?? 12, rule.slow ?? 26, rule.signal ?? 9);
    const i = n - 1;
    if (histogram[i] == null) return false;
    const mode = String(rule.mode || "hist_pos").toLowerCase();
    if (mode === "hist_pos") return histogram[i] > 0;
    if (mode === "hist_neg") return histogram[i] < 0;
    if (mode === "cross_up" && i > 0) {
      return (
        line[i] != null &&
        signal[i] != null &&
        line[i - 1] != null &&
        signal[i - 1] != null &&
        line[i - 1] <= signal[i - 1] &&
        line[i] > signal[i]
      );
    }
    if (mode === "cross_down" && i > 0) {
      return (
        line[i] != null &&
        signal[i] != null &&
        line[i - 1] != null &&
        signal[i - 1] != null &&
        line[i - 1] >= signal[i - 1] &&
        line[i] < signal[i]
      );
    }
    return compare(rule.operator || ">", histogram[i], Number(rule.value ?? 0));
  }

  if (ind === "BB" || ind === "BOLLINGER") {
    const mult = rule.mult ?? 2;
    const { lower, upper, middle } = bollinger(closes, period, mult);
    const i = n - 1;
    const price = closes[i];
    const mode = String(rule.mode || "touch_lower").toLowerCase();
    if (mode === "touch_lower") return lower[i] != null && price <= lower[i];
    if (mode === "touch_upper") return upper[i] != null && price >= upper[i];
    if (mode === "above_middle") return middle[i] != null && price > middle[i];
    return false;
  }

  return false;
}

/** Entry: all rules must pass. Exit: any rule passes (configurable). */
export function evaluateStrategy(definition, series, { exitMode = "any" } = {}) {
  const entryRules = Array.isArray(definition.entry) ? definition.entry : [];
  const exitRules = Array.isArray(definition.exit) ? definition.exit : [];

  const entryOk = entryRules.length === 0 ? false : entryRules.every((r) => evaluateRule(r, series));
  const exitResults = exitRules.map((r) => evaluateRule(r, series));
  const exitOk =
    exitMode === "all" ? exitResults.length > 0 && exitResults.every(Boolean) : exitResults.some(Boolean);

  return { entryOk, exitOk, exitTriggered: exitOk };
}
