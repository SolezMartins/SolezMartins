export interface Candle { time: number; open: number; high: number; low: number; close: number }
export type Bias = 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
export interface Swing { i: number; type: 'high' | 'low'; price: number }
export interface Fvg { dir: 'bullish' | 'bearish'; upper: number; lower: number; i: number; filled: boolean; filledI?: number; fillPct?: number }
export interface MarketAnalysisSnapshot {
  market: string; timeframe: string; bias: Bias; structure: string; momentum: string;
  rsi: number | null; emaAlignment: string; liquiditySweep: boolean; fvg: boolean;
  support: number[]; resistance: number[]; confluenceScore: number;
  htfStructure?: string; volatility?: string; rangeState?: string; majorSupport?: number[]; majorResistance?: number[]; patterns?: string[]; roc?: number | null;
}
export interface AIChatContext { snapshots: MarketAnalysisSnapshot[]; question: string; events?: Record<string, unknown[]>; overview?: unknown }
export interface AIProvider {
  generateAnalysis(input: MarketAnalysisSnapshot): Promise<string>;
  chat(input: AIChatContext): Promise<string>;
}
