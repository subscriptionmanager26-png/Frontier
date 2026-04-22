export type ArticleCardProps = {
  headline: string;
  source: string;
  summary: string;
  publishedAt: string;
  url?: string;
  imageUrl?: string;
};

export type OhlcvPoint = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

export type StockChartProps = {
  ticker: string;
  price: number;
  changePct: number;
  period: '1D' | '1W' | '1M' | '1Y';
  ohlcv?: OhlcvPoint[];
};

export type WeatherForecastDay = {
  day: string;
  condition: string;
  highC: number;
  lowC: number;
  rainChancePct?: number;
};

export type WeatherForecastProps = {
  location: string;
  currentTempC: number;
  condition: string;
  forecast: WeatherForecastDay[];
};

export type ProductCardProps = {
  name: string;
  brand: string;
  price: number;
  rating?: number;
  inStock: boolean;
  url?: string;
  imageUrl?: string;
};

export type RenderToolName =
  | 'render_article_card'
  | 'render_stock_chart'
  | 'render_weather_forecast'
  | 'render_product_card';

export type RenderToolPropsMap = {
  render_article_card: ArticleCardProps;
  render_stock_chart: StockChartProps;
  render_weather_forecast: WeatherForecastProps;
  render_product_card: ProductCardProps;
};

export type RenderedComponent<T extends RenderToolName = RenderToolName> = {
  id: string;
  component: T;
  props: RenderToolPropsMap[T];
};

export const COMPONENT_TOOLS = [
  {
    name: 'render_article_card',
    description:
      'Use when the user asks about news, latest updates, headlines, or article summaries.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        source: { type: 'string' },
        summary: { type: 'string' },
        publishedAt: { type: 'string' },
        url: { type: 'string' },
        imageUrl: { type: 'string' },
      },
      required: ['headline', 'source', 'summary', 'publishedAt'],
    },
  },
  {
    name: 'render_stock_chart',
    description:
      'Use when the user asks about stock/index prices, market moves, performance, or quick chart views.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        price: { type: 'number' },
        changePct: { type: 'number' },
        period: { type: 'string', enum: ['1D', '1W', '1M', '1Y'] },
        ohlcv: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              t: { type: 'string' },
              o: { type: 'number' },
              h: { type: 'number' },
              l: { type: 'number' },
              c: { type: 'number' },
              v: { type: 'number' },
            },
            required: ['t', 'o', 'h', 'l', 'c'],
          },
        },
      },
      required: ['ticker', 'price', 'changePct', 'period'],
    },
  },
  {
    name: 'render_weather_forecast',
    description:
      'Use when the user asks about weather, forecast, temperature, rain chance, or travel weather.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        currentTempC: { type: 'number' },
        condition: { type: 'string' },
        forecast: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'string' },
              condition: { type: 'string' },
              highC: { type: 'number' },
              lowC: { type: 'number' },
              rainChancePct: { type: 'number' },
            },
            required: ['day', 'condition', 'highC', 'lowC'],
          },
        },
      },
      required: ['location', 'currentTempC', 'condition', 'forecast'],
    },
  },
  {
    name: 'render_product_card',
    description:
      'Use when the user asks for shopping recommendations, product comparisons, prices, or buy options.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        brand: { type: 'string' },
        price: { type: 'number' },
        rating: { type: 'number' },
        inStock: { type: 'boolean' },
        url: { type: 'string' },
        imageUrl: { type: 'string' },
      },
      required: ['name', 'brand', 'price', 'inStock'],
    },
  },
] as const;
