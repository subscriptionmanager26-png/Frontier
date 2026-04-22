# Shared Contract — UI Registry

> **Both teams agree on this file before writing any code.**
> Version-control it. Neither team owns it — it's the API between them.
> Every addition to this file requires both teams to update their side.

---

## The Registry File

Create this file at `shared/ui-registry.ts` and copy it into both repos
(or publish as a private npm package if you have a monorepo).

```ts
// shared/ui-registry.ts

export const UI_COMPONENTS = {
  Stack:               { args: ['children: ref[]'] },
  Card:                { args: ['children: ref[]', 'variant?: default|secondary|tertiary'] },
  'Card.Title':        { args: ['text: string'] },
  'Card.Description':  { args: ['text: string'] },
  'Card.Footer':       { args: ['children: ref[]'] },
  Button:              { args: ['label: string', 'variant?: primary|secondary|ghost|danger'] },
  Alert:               { args: ['title: string', 'body: string', 'variant: success|danger|info'] },
  Chip:                { args: ['label: string', 'color?: default|success|danger'] },
  Tabs:                { args: ['items: string[]', 'content: ref[]'] },
  Table:               { args: ['columns: string[]', 'rows: any[][]'] },
  Skeleton:            { args: [] },
  Spinner:             { args: [] },
} as const

export type ComponentName = keyof typeof UI_COMPONENTS

export const DSL_RULES = `
- root = Stack([...]) MUST be the first line of every UI response
- One assignment per line: id = ComponentName(arg1, arg2)
- String values use double quotes: "hello"
- Arrays use bracket notation: [a, b, c]
- References are plain identifiers (no quotes): myCard
- Data lines (arrays/strings) are also valid: cols = ["Name", "Value"]
- Plain text responses: do NOT use DSL — return { "type": "text", "content": "..." }
`
```

---

## DSL Wire Format — Examples

### Example 1 — Simple card with button

```
root = Stack([card, cta])
card = Card([title, body], "default")
title = Card.Title("Q3 Results")
body = Card.Description("Revenue up 12% to $4.2M")
cta = Button("View details", "primary")
```

### Example 2 — Table

```
root = Stack([tbl])
cols = ["Name", "Value", "Change"]
rows = [["Equity", "₹1,24,500", "+2.4%"], ["Debt", "₹43,000", "+0.8%"]]
tbl = Table(cols, rows)
```

### Example 3 — Alert

```
root = Stack([a])
a = Alert("Success", "Your request was processed.", "success")
```

### Example 4 — Mixed layout

```
root = Stack([card, btn])
card = Card([t, d])
t = Card.Title("3 items found")
d = Card.Description("Showing results for your query")
btn = Button("See all", "secondary")
```

### Example 5 — Plain text response (no UI)

```json
{ "type": "text", "content": "Sure, here is the answer to your question..." }
```

---

## Adding a New Component — Coordination Protocol

1. Both teams agree on the component name and args in this file
2. Agent team: re-run `buildSystemPrompt()` — it auto-generates from the registry
3. App team: add one `case` to the renderer switch in `Renderer.tsx`
4. Agent team: add a fixture for it in `mock.ts`
5. Done — no other coordination needed

---

## Rules for Both Teams

| Rule | Agent team | App team |
|---|---|---|
| Never use a component not in the registry | Must validate before streaming | Render `<Skeleton>` for unknowns |
| `root` always comes first | Must output `root = Stack([...])` as line 1 | Fail gracefully if missing |
| No markdown in UI responses | System prompt enforces this | Detect `root =` to classify |
| Plain text uses JSON format | `{ "type": "text", "content": "..." }` | Parse and render as text bubble |
