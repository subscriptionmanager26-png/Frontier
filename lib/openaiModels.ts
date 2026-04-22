const MODELS_URL = 'https://api.openai.com/v1/models';

/** Heuristic: chat/completions-capable models vs embeddings, audio, images, etc. */
function isLikelyChatModel(id: string): boolean {
  const x = id.toLowerCase();
  if (
    /embedding|embed|whisper|tts|dall|moderation|davinci|curie|babbage|ada|text-search|code-search|realtime|transcribe|computer-use|sora|gpt-image|omni-moderation|audio-preview|tts-|text-moderation/.test(
      x
    )
  ) {
    return false;
  }
  if (/^gpt-|^o[0-9]|^chatgpt-/.test(x)) {
    return true;
  }
  if (/^ft:/.test(x)) {
    return true;
  }
  return false;
}

/** Lists model ids from GET /v1/models, filtered for typical chat use. */
export async function fetchOpenAiChatModels(apiKey: string): Promise<string[]> {
  const res = await fetch(MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 280)}`);
  }
  const data = JSON.parse(raw) as { data?: { id: string }[] };
  const ids = (data.data ?? []).map((m) => m.id);
  return [...new Set(ids.filter(isLikelyChatModel))].sort((a, b) => a.localeCompare(b));
}
