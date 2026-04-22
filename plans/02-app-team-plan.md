# App Team Plan — Expo / React Native

**Stack:** Expo (existing app with chat UI), TypeScript, HeroUI Native, Uniwind
**Goal:** Install HeroUI Native, build a DSL parser and renderer, wire it into
the existing chat screen so the agent's DSL responses render as native components.
**Timeline:** 3 weeks, ~10 hours of work

---

## Before You Start

Copy `shared/ui-registry.ts` into your repo at `src/shared/ui-registry.ts`.
The renderer imports component names from it — this keeps both teams in sync.

Point all your development at the agent team's mock endpoint:
`GET http://localhost:3001/mock/mixed`

Only switch to the real `POST /chat` during integration in week 3.

---

## Phase B1 — Install HeroUI Native + Uniwind

**Estimated time:** 2 hours

### Step 1 — Install packages

```bash
npx expo install heroui-native
npx expo install \
  react-native-reanimated \
  react-native-gesture-handler \
  react-native-screens \
  react-native-safe-area-context \
  react-native-svg \
  react-native-worklets \
  tailwind-variants \
  tailwind-merge \
  @gorhom/bottom-sheet
```

### Step 2 — Update `metro.config.js`

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')
const { wrapWithReanimatedMetroConfig } = require('react-native-reanimated/metro-config')

const config = getDefaultConfig(__dirname)

module.exports = withUniwindConfig(
  wrapWithReanimatedMetroConfig(config),
  { cssEntryFile: './global.css' }
)
```

### Step 3 — Create `global.css`

```css
/* global.css — default HeroUI theme, no customisation needed for MVP */
@import 'tailwindcss';
@import 'uniwind';
@import 'heroui-native/styles';
@source './node_modules/heroui-native/lib';
```

### Step 4 — Update `App.tsx` (or your root layout file)

```tsx
// App.tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { HeroUINativeProvider } from 'heroui-native'
import './global.css'

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <YourExistingNavigator />
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  )
}
```

### Done when

A hardcoded `<Button variant="primary">Test</Button>` renders in Expo Go.
Do not move to B2 until this works.

**Files modified:**
- `metro.config.js`
- `global.css` (new)
- `App.tsx`

---

## Phase B2 — Build the DSL parser

**Estimated time:** 2 hours

The parser reads the streaming text buffer and builds a node map.
It runs on every character change as the stream arrives, so it must be fast.

### Create `src/ui/parser.ts`

```ts
// src/ui/parser.ts

export type UINode = {
  id: string
  type: string
  rawArgs: string
}

export type NodeMap = Map<string, UINode | any>

// Matches: id = ComponentName(args)
const COMPONENT_RE = /^(\w+)\s*=\s*([\w.]+)\((.*)\)\s*$/

// Matches: id = ["a", "b"] or id = "string"
const DATA_RE = /^(\w+)\s*=\s*(\[[\s\S]*\]|"[^"]*")\s*$/

/**
 * Parse a full or partial DSL text into a node map.
 * Safe to call on every streaming chunk — handles incomplete last lines.
 */
export function parseDSL(text: string): NodeMap {
  const nodes: NodeMap = new Map()
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Try component line first
    const comp = trimmed.match(COMPONENT_RE)
    if (comp) {
      nodes.set(comp[1], {
        id: comp[1],
        type: comp[2],
        rawArgs: comp[3].trim(),
      } as UINode)
      continue
    }

    // Try data line (array or string)
    const data = trimmed.match(DATA_RE)
    if (data) {
      try {
        nodes.set(data[1], JSON.parse(data[2]))
      } catch {
        nodes.set(data[1], data[2].replace(/^"|"$/g, ''))
      }
    }
  }

  return nodes
}

/**
 * Split a top-level comma-separated arg string.
 * Handles nested arrays: splitTopLevel('cols, rows') → ['cols', 'rows']
 * Handles: splitTopLevel('"hello", "world"') → ['"hello"', '"world"']
 */
export function splitTopLevel(raw: string): string[] {
  const results: string[] = []
  let depth = 0
  let current = ''

  for (const char of raw) {
    if (char === '[') depth++
    if (char === ']') depth--
    if (char === ',' && depth === 0) {
      results.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) results.push(current.trim())
  return results
}

/**
 * Resolve a raw args string into actual values.
 * Refs (plain identifiers) are looked up in the node map.
 * Arrays, strings, numbers, booleans are parsed directly.
 */
export function resolveArgs(rawArgs: string, nodes: NodeMap): any[] {
  if (!rawArgs.trim()) return []

  const tokens = splitTopLevel(rawArgs)

  return tokens.map(token => {
    const t = token.trim()

    // Reference to another node
    if (nodes.has(t)) return nodes.get(t)

    // Array literal
    if (t.startsWith('[')) {
      try { return JSON.parse(t) } catch {}
      // Array of refs: [a, b, c]
      const inner = t.slice(1, -1)
      return splitTopLevel(inner).map(ref => ref.trim())
    }

    // String literal
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)

    // Number
    if (!isNaN(Number(t))) return Number(t)

    // Boolean
    if (t === 'true') return true
    if (t === 'false') return false

    // Unknown — return as-is (might be an unresolved ref, renders as Skeleton)
    return t
  })
}
```

### How to test the parser in isolation

```ts
// Quick test — paste into a scratch file or unit test
import { parseDSL, resolveArgs } from './parser'

const dsl = `
root = Stack([card, btn])
card = Card([t, d])
t = Card.Title("Hello")
d = Card.Description("World")
btn = Button("Click me", "primary")
`

const nodes = parseDSL(dsl)
console.log(nodes.get('root'))
// → { id: 'root', type: 'Stack', rawArgs: '[card, btn]' }

console.log(resolveArgs('[card, btn]', nodes))
// → [{ id: 'card', ... }, { id: 'btn', ... }]
```

**Files created:**
- `src/ui/parser.ts`

---

## Phase B3 — Build the renderer

**Estimated time:** 3 hours

The renderer maps each node type to a HeroUI Native component.
Any unresolved ref or unknown component type renders as `<Skeleton>`.

### Step 1 — Build `DataTable` (HeroUI has no table component)

```tsx
// src/ui/components/DataTable.tsx
import { View, Text, FlatList } from 'react-native'
import { Surface, Separator } from 'heroui-native'

type DataTableProps = {
  columns: string[]
  rows: any[][]
}

export function DataTable({ columns, rows }: DataTableProps) {
  if (!columns?.length) return null

  return (
    <Surface variant="secondary" className="rounded-2xl overflow-hidden">
      {/* Header row */}
      <View className="flex-row px-4 py-2 bg-surface-secondary">
        {columns.map((col, i) => (
          <Text
            key={i}
            className="flex-1 text-muted text-xs font-medium uppercase"
          >
            {col}
          </Text>
        ))}
      </View>

      <Separator />

      {/* Data rows */}
      <FlatList
        data={rows}
        keyExtractor={(_, i) => String(i)}
        scrollEnabled={false}
        ItemSeparatorComponent={() => <Separator />}
        renderItem={({ item }) => (
          <View className="flex-row px-4 py-3">
            {(item as any[]).map((cell, j) => (
              <Text key={j} className="flex-1 text-foreground text-sm">
                {String(cell)}
              </Text>
            ))}
          </View>
        )}
      />
    </Surface>
  )
}
```

### Step 2 — Build `src/ui/Renderer.tsx`

```tsx
// src/ui/Renderer.tsx
import React from 'react'
import { View, Text } from 'react-native'
import {
  Card,
  Button,
  Alert,
  Chip,
  Skeleton,
  Spinner,
} from 'heroui-native'
import { DataTable } from './components/DataTable'
import { parseDSL, resolveArgs, UINode, NodeMap } from './parser'

/**
 * Recursively render a single UINode.
 */
function renderNode(node: UINode, nodes: NodeMap): React.ReactNode {
  const args = resolveArgs(node.rawArgs, nodes)

  // Helper: render a list of child refs
  const renderChildren = (refs: any[]): React.ReactNode[] => {
    if (!Array.isArray(refs)) return []
    return refs.map((ref, i) => {
      if (typeof ref === 'string') {
        const child = nodes.get(ref)
        if (!child) return <Skeleton key={ref} />
        if (child && typeof child === 'object' && 'type' in child) {
          return <View key={ref}>{renderNode(child as UINode, nodes)}</View>
        }
        return null
      }
      if (ref && typeof ref === 'object' && 'type' in ref) {
        return <View key={i}>{renderNode(ref as UINode, nodes)}</View>
      }
      return null
    }).filter(Boolean)
  }

  switch (node.type) {
    case 'Stack':
      return (
        <View className="gap-3">
          {renderChildren(args[0])}
        </View>
      )

    case 'Card':
      return (
        <Card variant={args[1] ?? 'default'}>
          {renderChildren(args[0])}
        </Card>
      )

    case 'Card.Title':
      return <Card.Title>{String(args[0] ?? '')}</Card.Title>

    case 'Card.Description':
      return <Card.Description>{String(args[0] ?? '')}</Card.Description>

    case 'Card.Footer':
      return (
        <Card.Footer>
          <View className="flex-row gap-2">
            {renderChildren(args[0])}
          </View>
        </Card.Footer>
      )

    case 'Button':
      return (
        <Button variant={args[1] ?? 'primary'}>
          {String(args[0] ?? 'Button')}
        </Button>
      )

    case 'Alert':
      return (
        <Alert variant={args[2] ?? 'info'}>
          <Alert.Title>{String(args[0] ?? '')}</Alert.Title>
          <Alert.Description>{String(args[1] ?? '')}</Alert.Description>
        </Alert>
      )

    case 'Chip':
      return (
        <Chip color={args[1] ?? 'default'}>
          {String(args[0] ?? '')}
        </Chip>
      )

    case 'Table':
      return <DataTable columns={args[0]} rows={args[1]} />

    case 'Tabs':
      // Simplified for MVP — just show a tab bar, content as placeholder
      return (
        <View>
          <View className="flex-row gap-2">
            {(args[0] ?? []).map((label: string, i: number) => (
              <Chip key={i} color="default">{label}</Chip>
            ))}
          </View>
        </View>
      )

    case 'Spinner':
      return <Spinner />

    case 'Skeleton':
      return <Skeleton />

    default:
      // Unknown component — render skeleton, log warning
      console.warn('UIRenderer: unknown component type:', node.type)
      return <Skeleton />
  }
}

type UIRendererProps = {
  /** The full or partial DSL text as it streams in */
  dslText: string
}

/**
 * Parses DSL text and renders the component tree.
 * Safe to call on every streaming chunk — re-renders as nodes resolve.
 */
export function UIRenderer({ dslText }: UIRendererProps) {
  const nodes = parseDSL(dslText)
  const root = nodes.get('root')

  if (!root) {
    // root line hasn't arrived yet — show skeleton
    return (
      <View className="gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-12" />
      </View>
    )
  }

  if (typeof root !== 'object' || !('type' in root)) {
    return <Skeleton />
  }

  return <>{renderNode(root as UINode, nodes)}</>
}
```

**Files created:**
- `src/ui/components/DataTable.tsx`
- `src/ui/Renderer.tsx`

---

## Phase B4 — SSE client hook + wire into existing chat screen

**Estimated time:** 2 hours

### Step 1 — Create `src/hooks/useAgentStream.ts`

```ts
// src/hooks/useAgentStream.ts
import { useState, useCallback } from 'react'

type Message = { role: 'user' | 'assistant'; content: string }

type UseAgentStreamOptions = {
  agentUrl: string
}

export function useAgentStream({ agentUrl }: UseAgentStreamOptions) {
  const [buffer, setBuffer] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(async (messages: Message[]) => {
    setBuffer('')
    setError(null)
    setIsStreaming(true)

    try {
      const response = await fetch(`${agentUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const payload = line.slice(6).trim()

          if (payload === '[DONE]') {
            setIsStreaming(false)
            return
          }

          try {
            const { delta, error: streamError } = JSON.parse(payload)
            if (streamError) throw new Error(streamError)
            if (delta) setBuffer(prev => prev + delta)
          } catch (e) {
            console.warn('Failed to parse SSE chunk:', payload)
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      console.error('Stream error:', err)
    } finally {
      setIsStreaming(false)
    }
  }, [agentUrl])

  const reset = useCallback(() => {
    setBuffer('')
    setError(null)
    setIsStreaming(false)
  }, [])

  return { buffer, isStreaming, error, send, reset }
}
```

### Step 2 — Update your existing `MessageBubble` component

```tsx
// src/chat/MessageBubble.tsx — update your existing component

import { View, Text } from 'react-native'
import { Spinner } from 'heroui-native'
import { UIRenderer } from '../ui/Renderer'

type MessageBubbleProps = {
  content: string
  role: 'user' | 'assistant'
  isStreaming?: boolean
}

export function MessageBubble({ content, role, isStreaming = false }: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <View className="self-end bg-accent rounded-2xl px-4 py-3 max-w-[80%]">
        <Text className="text-accent-foreground">{content}</Text>
      </View>
    )
  }

  // Detect DSL response — always starts with "root ="
  const isUI = content.trimStart().startsWith('root =')

  // Detect plain text JSON response
  if (!isUI && content.trimStart().startsWith('{"type":"text"')) {
    try {
      const parsed = JSON.parse(content.trim())
      return (
        <View className="bg-surface rounded-2xl px-4 py-3 max-w-[85%]">
          <Text className="text-foreground">{parsed.content}</Text>
          {isStreaming && <Spinner size="sm" className="mt-2" />}
        </View>
      )
    } catch {
      // Fall through to plain text rendering
    }
  }

  if (isUI) {
    return (
      <View className="w-full">
        <UIRenderer dslText={content} />
        {isStreaming && (
          <View className="mt-2 items-center">
            <Spinner size="sm" />
          </View>
        )}
      </View>
    )
  }

  // Plain text fallback
  return (
    <View className="bg-surface rounded-2xl px-4 py-3 max-w-[85%]">
      <Text className="text-foreground">{content}</Text>
      {isStreaming && <Spinner size="sm" className="mt-2" />}
    </View>
  )
}
```

### Step 3 — Update your existing chat screen

```tsx
// src/chat/ChatScreen.tsx — update your existing screen
// Key changes only — keep your existing input, scroll, and message list

import { useAgentStream } from '../hooks/useAgentStream'
import { MessageBubble } from './MessageBubble'

// During development, point at mock endpoint
const AGENT_URL = __DEV__
  ? 'http://localhost:3001'   // switch to real URL in production
  : 'https://your-agent-server.com'

export function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([])
  const { buffer, isStreaming, error, send, reset } = useAgentStream({ agentUrl: AGENT_URL })

  const handleSend = async (text: string) => {
    const userMessage = { role: 'user' as const, content: text }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)

    // Send to agent — buffer accumulates the streaming response
    await send(updatedMessages)

    // Once done, commit the buffer as an assistant message
    setMessages(prev => [
      ...prev,
      { role: 'assistant', content: buffer },
    ])
    reset()
  }

  return (
    // ... your existing layout ...
    <>
      {messages.map((msg, i) => (
        <MessageBubble
          key={i}
          content={msg.content}
          role={msg.role}
          isStreaming={false}
        />
      ))}

      {/* Show live streaming buffer as it arrives */}
      {isStreaming && buffer && (
        <MessageBubble
          content={buffer}
          role="assistant"
          isStreaming={true}
        />
      )}

      {error && (
        <Text className="text-danger text-sm text-center">{error}</Text>
      )}
    </>
  )
}
```

**Files created/modified:**
- `src/hooks/useAgentStream.ts` (new)
- `src/chat/MessageBubble.tsx` (modified)
- `src/chat/ChatScreen.tsx` (modified)

---

## Complete File Structure

```
your-expo-app/
├── src/
│   ├── shared/
│   │   └── ui-registry.ts          ← copied from shared contract
│   ├── ui/
│   │   ├── parser.ts               ← DSL parser (B2)
│   │   ├── Renderer.tsx            ← component renderer (B3)
│   │   └── components/
│   │       └── DataTable.tsx       ← custom table component (B3)
│   ├── hooks/
│   │   └── useAgentStream.ts       ← SSE streaming hook (B4)
│   └── chat/
│       ├── MessageBubble.tsx       ← updated (B4)
│       └── ChatScreen.tsx          ← updated (B4)
├── global.css                      ← new (B1)
├── metro.config.js                 ← updated (B1)
└── App.tsx                         ← updated (B1)
```

---

## Testing Checklist

Before integration week, test each scenario against the mock endpoint:

- [ ] `GET /mock/card` — Card renders with title and description
- [ ] `GET /mock/button` — Card + Button renders, button is tappable
- [ ] `GET /mock/alert_success` — Green success alert renders
- [ ] `GET /mock/alert_danger` — Red danger alert renders
- [ ] `GET /mock/table` — Table renders with correct columns and rows
- [ ] `GET /mock/chips` — Chip components render with correct colors
- [ ] `GET /mock/mixed` — Full multi-component layout renders correctly
- [ ] `GET /mock/spinner` — Spinner renders and animates
- [ ] Skeleton shows while `root =` line hasn't arrived yet
- [ ] Plain text messages render as text bubbles (not UI)
- [ ] Error state shows a readable message if the connection fails

---

## Week-by-Week

| Week | Tasks |
|---|---|
| Week 1 | B1 (HeroUI install), B2 (parser — test against mock) |
| Week 2 | B3 (renderer — test all 8 mock scenarios), B4 (SSE hook) |
| Week 3 | Wire into real ChatScreen, switch from mock to real agent endpoint |
