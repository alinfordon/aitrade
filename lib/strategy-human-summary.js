/**
 * Descrieri în română pentru reguli de strategie (aliniat cu server/engine/strategy-eval.js).
 * @param {object} rule
 * @returns {string | null}
 */
export function describeStrategyRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const ind = String(rule.indicator || "").toUpperCase();
  if (!ind) return null;

  const op = rule.operator != null ? String(rule.operator) : "";
  const val = rule.value;
  const period = rule.period ?? 14;
  const fast = rule.fast ?? 9;
  const slow = rule.slow ?? 21;

  if (ind === "RSI") {
    const v = val != null ? val : "—";
    return `RSI (${period}): ultima valoare să fie ${op || "<"} ${v}`;
  }

  if (ind === "EMA_CROSS") {
    const want = String(val ?? "BULLISH").toUpperCase();
    if (want === "BULLISH") {
      return `Cross EMA: rapidă (${fast}) trece peste lentă (${slow}) — semnal bullish`;
    }
    if (want === "BEARISH") {
      return `Cross EMA: rapidă (${fast}) trece sub lentă (${slow}) — semnal bearish`;
    }
    return `EMA cross ${fast}/${slow} (${want})`;
  }

  if (ind === "SMA" || ind === "EMA") {
    const name = ind === "SMA" ? "SMA" : "EMA";
    return `Preț închidere ${op || ">"} valoarea ${name} (${period})`;
  }

  if (ind === "MACD") {
    const mode = String(rule.mode || "hist_pos").toLowerCase();
    const map = {
      hist_pos: "histogramă MACD > 0",
      hist_neg: "histogramă MACD < 0",
      cross_up: "cross linie MACD peste semnal",
      cross_down: "cross linie MACD sub semnal",
    };
    const extra = map[mode] || `mod ${mode}`;
    if (rule.operator != null && rule.value != null) {
      return `MACD (${extra}): ${op} ${rule.value}`;
    }
    return `MACD: ${extra}`;
  }

  if (ind === "BB" || ind === "BOLLINGER") {
    const mode = String(rule.mode || "touch_lower").toLowerCase();
    const mult = rule.mult ?? 2;
    const map = {
      touch_lower: "atinge banda Bollinger inferioară",
      touch_upper: "atinge banda Bollinger superioară",
      above_middle: "preț peste banda mediană",
    };
    return `Benzi Bollinger (${period}, mult. ${mult}): ${map[mode] || mode}`;
  }

  return `${ind}${val != null ? `: ${JSON.stringify(val)}` : ""}`;
}

/**
 * @param {unknown} definition
 * @returns {{ entryLines: string[], exitLines: string[] }}
 */
export function summarizeStrategyDefinition(definition) {
  const def = definition && typeof definition === "object" ? definition : {};
  const entry = Array.isArray(def.entry) ? def.entry : [];
  const exit = Array.isArray(def.exit) ? def.exit : [];
  return {
    entryLines: entry.map(describeStrategyRule).filter((x) => typeof x === "string" && x.length > 0),
    exitLines: exit.map(describeStrategyRule).filter((x) => typeof x === "string" && x.length > 0),
  };
}
