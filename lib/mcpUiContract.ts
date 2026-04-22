/**
 * Whitelisted UI blocks the assistant may emit inside ```mcp-ui ...``` fences.
 * Parsed JSON only — never execute arbitrary code from the model.
 */

export type McpUiNoticeVariant = 'info' | 'success' | 'warning' | 'error';
export type McpUiMediaFit = 'cover' | 'contain';

export type McpUiMediaSource = {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  posterUrl?: string;
  caption?: string;
};

export type McpUiBlock =
  | {
      type: 'notice';
      variant?: McpUiNoticeVariant;
      title?: string;
      body: string;
    }
  | {
      type: 'keyValue';
      rows: { k: string; v: string }[];
    }
  | {
      type: 'bulletList';
      items: string[];
    }
  | {
      type: 'buttonRow';
      buttons: { label: string; actionId: string }[];
    }
  | {
      type: 'image';
      src: McpUiMediaSource;
      alt?: string;
      fit?: McpUiMediaFit;
    }
  | {
      type: 'video';
      src: McpUiMediaSource;
      autoplay?: boolean;
      loop?: boolean;
      muted?: boolean;
    }
  | {
      type: 'audio';
      src: McpUiMediaSource;
      title?: string;
      artist?: string;
    }
  | {
      type: 'file';
      url: string;
      name: string;
      mimeType?: string;
      sizeBytes?: number;
      note?: string;
    }
  | {
      type: 'gallery';
      items: Array<{
        src: McpUiMediaSource;
        alt?: string;
      }>;
      title?: string;
    }
  | {
      type: 'linkPreview';
      url: string;
      title?: string;
      description?: string;
      imageUrl?: string;
      siteName?: string;
    };

export type McpUiPayload = { version: 1; blocks: McpUiBlock[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function asString(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

function asNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function asBool(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null;
}

function isHttpUrl(x: string): boolean {
  return /^https?:\/\//i.test(x.trim());
}

function parseMediaSource(x: unknown): McpUiMediaSource | null {
  if (!isRecord(x)) return null;
  const url = asString(x.url) ?? asString(x.src);
  if (!url || !isHttpUrl(url)) return null;
  return {
    url,
    mimeType: asString(x.mimeType) ?? asString(x.type) ?? undefined,
    width: asNumber(x.width) ?? undefined,
    height: asNumber(x.height) ?? undefined,
    posterUrl: asString(x.posterUrl) ?? asString(x.poster) ?? undefined,
    caption: asString(x.caption) ?? undefined,
  };
}

function parseBlock(b: unknown): McpUiBlock | null {
  if (!isRecord(b)) return null;
  const type = asString(b.type);
  if (!type) return null;

  if (type === 'notice') {
    const body = asString(b.body);
    if (!body) return null;
    const variant = asString(b.variant) as McpUiNoticeVariant | null;
    const ok =
      !variant || ['info', 'success', 'warning', 'error'].includes(variant);
    return {
      type: 'notice',
      variant: ok ? variant ?? 'info' : 'info',
      title: asString(b.title) ?? undefined,
      body,
    };
  }

  if (type === 'keyValue') {
    const rowsIn = b.rows;
    if (!Array.isArray(rowsIn)) return null;
    const rows: { k: string; v: string }[] = [];
    for (const r of rowsIn) {
      if (!isRecord(r)) continue;
      const k = asString(r.k) ?? asString(r.key);
      const v = asString(r.v) ?? asString(r.value);
      if (k != null && v != null) rows.push({ k, v });
    }
    if (!rows.length) return null;
    return { type: 'keyValue', rows };
  }

  if (type === 'bulletList') {
    const itemsIn = b.items;
    if (!Array.isArray(itemsIn)) return null;
    const items = itemsIn.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (!items.length) return null;
    return { type: 'bulletList', items };
  }

  if (type === 'buttonRow') {
    const buttonsIn = b.buttons;
    if (!Array.isArray(buttonsIn)) return null;
    const buttons: { label: string; actionId: string }[] = [];
    for (const btn of buttonsIn) {
      if (!isRecord(btn)) continue;
      const label = asString(btn.label);
      const actionId = asString(btn.actionId) ?? asString(btn.action);
      if (label && actionId) buttons.push({ label, actionId });
    }
    if (!buttons.length) return null;
    return { type: 'buttonRow', buttons };
  }

  if (type === 'image') {
    const src = parseMediaSource(b.src ?? b.image ?? b.media);
    if (!src) return null;
    const fit = asString(b.fit);
    const fitOk: McpUiMediaFit = fit === 'contain' ? 'contain' : 'cover';
    return {
      type: 'image',
      src,
      alt: asString(b.alt) ?? undefined,
      fit: fitOk,
    };
  }

  if (type === 'video') {
    const src = parseMediaSource(b.src ?? b.video ?? b.media);
    if (!src) return null;
    return {
      type: 'video',
      src,
      autoplay: asBool(b.autoplay) ?? false,
      loop: asBool(b.loop) ?? false,
      muted: asBool(b.muted) ?? false,
    };
  }

  if (type === 'audio') {
    const src = parseMediaSource(b.src ?? b.audio ?? b.media);
    if (!src) return null;
    return {
      type: 'audio',
      src,
      title: asString(b.title) ?? undefined,
      artist: asString(b.artist) ?? undefined,
    };
  }

  if (type === 'file') {
    const url = asString(b.url);
    const name = asString(b.name) ?? asString(b.label);
    if (!url || !isHttpUrl(url) || !name) return null;
    return {
      type: 'file',
      url,
      name,
      mimeType: asString(b.mimeType) ?? asString(b.type) ?? undefined,
      sizeBytes: asNumber(b.sizeBytes) ?? asNumber(b.size) ?? undefined,
      note: asString(b.note) ?? undefined,
    };
  }

  if (type === 'gallery') {
    const itemsIn = b.items;
    if (!Array.isArray(itemsIn)) return null;
    const items: Array<{ src: McpUiMediaSource; alt?: string }> = [];
    for (const item of itemsIn) {
      if (!isRecord(item)) continue;
      const src = parseMediaSource(item.src ?? item.image ?? item.media);
      if (!src) continue;
      items.push({ src, alt: asString(item.alt) ?? undefined });
    }
    if (!items.length) return null;
    return { type: 'gallery', items, title: asString(b.title) ?? undefined };
  }

  if (type === 'linkPreview') {
    const url = asString(b.url) ?? asString(b.href);
    if (!url || !isHttpUrl(url)) return null;
    const imageUrl = asString(b.imageUrl) ?? asString(b.image) ?? undefined;
    return {
      type: 'linkPreview',
      url,
      title: asString(b.title) ?? undefined,
      description: asString(b.description) ?? undefined,
      imageUrl: imageUrl && isHttpUrl(imageUrl) ? imageUrl : undefined,
      siteName: asString(b.siteName) ?? undefined,
    };
  }

  return null;
}

/** Parse and validate assistant ```mcp-ui``` JSON. */
export function parseMcpUiPayload(raw: string): McpUiPayload | null {
  try {
    const j = JSON.parse(raw) as unknown;
    if (!isRecord(j)) return null;
    if (j.version !== 1) return null;
    const blocksIn = j.blocks;
    if (!Array.isArray(blocksIn)) return null;
    const blocks: McpUiBlock[] = [];
    for (const b of blocksIn) {
      const p = parseBlock(b);
      if (p) blocks.push(p);
    }
    if (!blocks.length) return null;
    return { version: 1, blocks };
  } catch {
    return null;
  }
}
