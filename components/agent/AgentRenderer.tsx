import { ArticleCard } from '@/components/agent/ArticleCard';
import { ProductCard } from '@/components/agent/ProductCard';
import { StockChart } from '@/components/agent/StockChart';
import { WeatherForecast } from '@/components/agent/WeatherForecast';
import type { RenderToolName, RenderToolPropsMap } from '@/lib/agent/tools';

type Props<T extends RenderToolName = RenderToolName> = {
  component: T;
  props: RenderToolPropsMap[T];
};

export function AgentRenderer({ component, props }: Props) {
  switch (component) {
    case 'render_article_card':
      return <ArticleCard {...(props as RenderToolPropsMap['render_article_card'])} />;
    case 'render_stock_chart':
      return <StockChart {...(props as RenderToolPropsMap['render_stock_chart'])} />;
    case 'render_weather_forecast':
      return <WeatherForecast {...(props as RenderToolPropsMap['render_weather_forecast'])} />;
    case 'render_product_card':
      return <ProductCard {...(props as RenderToolPropsMap['render_product_card'])} />;
    default:
      return null;
  }
}
