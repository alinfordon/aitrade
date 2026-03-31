/** Split CCXT OHLCV rows into parallel arrays. */
export function ohlcvToSeries(rows) {
  const closes = [];
  const highs = [];
  const lows = [];
  const opens = [];
  const vols = [];
  for (const r of rows) {
    opens.push(r[1]);
    highs.push(r[2]);
    lows.push(r[3]);
    closes.push(r[4]);
    vols.push(r[5]);
  }
  return { opens, highs, lows, closes, vols };
}
