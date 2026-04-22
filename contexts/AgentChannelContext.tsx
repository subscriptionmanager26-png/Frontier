import { createContext, useContext, type ReactNode } from 'react';

import { type AgentChatScope, useAgent } from '@/hooks/useAgent';

type AgentChannelValue = ReturnType<typeof useAgent>;

const AgentChannelContext = createContext<AgentChannelValue | null>(null);

export function AgentChannelProvider({ scope, children }: { scope: AgentChatScope; children: ReactNode }) {
  const value = useAgent(scope);
  return <AgentChannelContext.Provider value={value}>{children}</AgentChannelContext.Provider>;
}

export function useAgentChannel(): AgentChannelValue {
  const v = useContext(AgentChannelContext);
  if (!v) {
    throw new Error('useAgentChannel must be used within AgentChannelProvider');
  }
  return v;
}
