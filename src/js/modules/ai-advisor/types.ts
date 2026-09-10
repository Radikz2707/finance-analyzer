export interface UIOrdersData {
  md: string;
}

export interface PriceAlertConfig {
  upperLimit: number;
  lowerLimit: number;
  upperMessage: string;
  lowerMessage: string;
}

export interface PriceAlert {
  ticker: string;
  name: string;
  currentPrice: number;
  upperLimit: number;
  lowerLimit: number;
  direction: 'upper' | 'lower' | null;
  message: string;
}
