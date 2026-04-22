import type { AgentUiMessage } from '@/hooks/useAgent';
import type { RenderToolName } from '@/lib/agent/tools';
import { classifyAgentPayload } from '@/lib/dslUi';
import { previewText } from '@/lib/threadMessages';

export type ClassifyFn = typeof classifyAgentPayload;

export type ReplyPreview =
  | { mode: 'text'; excerpt: string }
  | {
      mode: 'attachment';
      /** Lowercase noun after "attached …" (e.g. chart, article). */
      noun: string;
      icon: string;
      /** Optional short label (e.g. headline) when distinct from the noun. */
      label?: string;
    };

function firstLinePlain(parent: AgentUiMessage, classify: ClassifyFn): string {
  if (!parent.text?.trim()) return '';
  const c = classify(parent.text);
  if (c.kind === 'text_json') return c.content;
  if (c.kind === 'plain') return c.content;
  return '';
}

function attachmentFromComponent(
  component: RenderToolName,
  props: unknown
): { noun: string; icon: string; label?: string } {
  const p = props as Record<string, unknown>;
  switch (component) {
    case 'render_article_card':
      return {
        noun: 'article',
        icon: 'newspaper-o',
        label: typeof p.headline === 'string' ? previewText(p.headline, 48) : undefined,
      };
    case 'render_stock_chart':
      return { noun: 'chart', icon: 'line-chart' };
    case 'render_weather_forecast':
      return {
        noun: 'forecast',
        icon: 'cloud',
        label: typeof p.location === 'string' ? previewText(p.location, 32) : undefined,
      };
    case 'render_product_card':
      return {
        noun: 'product',
        icon: 'cube',
        label: typeof p.name === 'string' ? previewText(p.name, 40) : undefined,
      };
    default:
      return { noun: 'content', icon: 'paperclip' };
  }
}

/**
 * How to summarize the *parent* message in a reply row (matches thread-demo: text excerpt vs attached + icon).
 */
export function parentReplyPreview(parent: AgentUiMessage | undefined, classify: ClassifyFn): ReplyPreview | null {
  if (!parent) return null;

  if (parent.role === 'user') {
    const excerpt = previewText(parent.text || '', 120);
    return { mode: 'text', excerpt: excerpt || '(empty message)' };
  }

  if (parent.components?.length) {
    const first = parent.components[0]!;
    const { noun, icon, label } = attachmentFromComponent(first.component, first.props);
    return { mode: 'attachment', noun, icon, label };
  }

  const plain = firstLinePlain(parent, classify);
  if (plain.trim()) {
    return { mode: 'text', excerpt: previewText(plain, 120) };
  }

  if (parent.text?.trim()) {
    const c = classify(parent.text);
    if (c.kind === 'dsl') {
      return { mode: 'attachment', noun: 'layout', icon: 'th-large' };
    }
  }

  return { mode: 'text', excerpt: '(message)' };
}
