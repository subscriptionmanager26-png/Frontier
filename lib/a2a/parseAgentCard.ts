/**
 * Best-effort parse of A2A agent-card.json / agent.json for structured UI.
 * Tolerates missing or differently shaped fields.
 */

export type ParsedAgentCapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
};

export type ParsedAgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  example: string;
};

export type ParsedAgentInterface = {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
};

export type ParsedAgentCard = {
  name: string;
  organization: string;
  description: string;
  url: string;
  version: string;
  capabilities: ParsedAgentCapabilities;
  skills: ParsedAgentSkill[];
  interfaces: ParsedAgentInterface[];
  securitySchemeKeys: string[];
};

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(x: unknown): string {
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return '';
}

function boolish(x: unknown): boolean | undefined {
  if (x === true || x === 'true') return true;
  if (x === false || x === 'false') return false;
  return undefined;
}

function emptyCard(fallbackUrl?: string): ParsedAgentCard {
  return {
    name: '',
    organization: '',
    description: '',
    url: (fallbackUrl || '').trim(),
    version: '',
    capabilities: {},
    skills: [],
    interfaces: [],
    securitySchemeKeys: [],
  };
}

export function parseAgentCard(doc: unknown, fallbackUrl?: string): ParsedAgentCard {
  const root = asRecord(doc);
  if (!root) return emptyCard(fallbackUrl);

  const agent = asRecord(root.agent);
  const provider = asRecord(root.provider);
  const capabilitiesRaw = asRecord(root.capabilities);

  const name = str(root.name) || str(agent?.name) || '';
  const organization = str(provider?.organization);
  const description = str(root.description) || str(agent?.description);
  const url = str(root.url) || str(root.endpoint) || (fallbackUrl || '').trim();
  const protocolRec = asRecord(root.protocol);
  const version =
    str(root.version) ||
    str(root.protocolVersion) ||
    str(protocolRec?.version);

  const capabilities: ParsedAgentCapabilities = {};
  if (capabilitiesRaw) {
    const s = boolish(capabilitiesRaw.streaming);
    const p = boolish(capabilitiesRaw.pushNotifications);
    const h = boolish(capabilitiesRaw.stateTransitionHistory);
    if (s !== undefined) capabilities.streaming = s;
    if (p !== undefined) capabilities.pushNotifications = p;
    if (h !== undefined) capabilities.stateTransitionHistory = h;
  }

  const skills: ParsedAgentSkill[] = [];
  if (Array.isArray(root.skills)) {
    for (const item of root.skills) {
      const s = asRecord(item);
      if (!s) continue;
      const tagsRaw = s.tags;
      const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => str(t)).filter(Boolean) : [];
      const examples = s.examples;
      let example = '';
      if (Array.isArray(examples) && examples.length > 0) {
        const ex0 = examples[0];
        example = typeof ex0 === 'string' ? ex0.trim() : JSON.stringify(ex0, null, 2);
      }
      skills.push({
        id: str(s.id),
        name: str(s.name),
        description: str(s.description),
        tags,
        example,
      });
    }
  }

  const interfaces: ParsedAgentInterface[] = [];
  if (Array.isArray(root.supportedInterfaces)) {
    for (const item of root.supportedInterfaces) {
      const iface = asRecord(item);
      if (!iface) continue;
      interfaces.push({
        url: str(iface.url),
        protocolBinding: str(iface.protocolBinding),
        protocolVersion: str(iface.protocolVersion),
      });
    }
  }

  const securityRaw = asRecord(root.securitySchemes);
  const securitySchemeKeys = securityRaw ? Object.keys(securityRaw).sort() : [];

  return {
    name,
    organization,
    description,
    url,
    version,
    capabilities,
    skills,
    interfaces,
    securitySchemeKeys,
  };
}
