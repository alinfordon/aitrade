/** Built-in example strategies (dynamic JSON) for onboarding and tests. */

export const rsiEmaExample = {
  name: "RSI + EMA Cross (example)",
  definition: {
    entry: [
      { indicator: "RSI", operator: "<", value: 30, period: 14 },
      { indicator: "EMA_CROSS", value: "BULLISH", fast: 9, slow: 21 },
    ],
    exit: [{ indicator: "RSI", operator: ">", value: 70, period: 14 }],
  },
};

export const bollingerRsiExample = {
  name: "Bollinger touch + RSI (example)",
  definition: {
    entry: [
      { indicator: "BB", mode: "touch_lower", period: 20, mult: 2 },
      { indicator: "RSI", operator: "<", value: 35, period: 14 },
    ],
    exit: [
      { indicator: "BB", mode: "touch_upper", period: 20, mult: 2 },
      { indicator: "RSI", operator: ">", value: 65, period: 14 },
    ],
  },
};

export const macdCrossExample = {
  name: "MACD cross up (example)",
  definition: {
    entry: [{ indicator: "MACD", mode: "cross_up", fast: 12, slow: 26, signal: 9 }],
    exit: [{ indicator: "MACD", mode: "cross_down", fast: 12, slow: 26, signal: 9 }],
  },
};

export const allExamples = [rsiEmaExample, bollingerRsiExample, macdCrossExample];
