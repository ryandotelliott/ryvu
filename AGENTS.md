# PR Guide

## UI components

Pick the first layer that fits:

1. **shadcn primitives** (`base-nova` style, built on Base UI) in `src/web/components/ui/`. When one is missing, add it with `pnpm dlx shadcn@latest add <name>` before building your own. Use Base UI directly only when shadcn has no wrapper for it.
2. **App primitives** in `src/web/ui.tsx`: small, generic building blocks that compose shadcn parts and are reused across pages, such as `Tip` (tooltip with a delay variant and an optional hotkey), `Segmented`, `Switch`, `ResizeHandle` and `Avatar`. Add one here when the same pattern shows up in two places, or when a control is clearly generic. Keep app data types out of them.
3. **Feature components** next to the feature (`pull.tsx`, `file-tree.tsx`, `comments.tsx`, …) for anything specific to one screen.

Hand-style elements only when no primitive fits, such as the file and outline rows.

### Tooltips

Use `Tip` from `src/web/ui.tsx`, never the `title` attribute.

- `delay`: `long` (700ms) for labels on content you read, such as truncated names and timestamps. `short` (300ms, the default) for icon buttons. `instant` for dense controls you scan, such as the section rail.
- `hotkey`: pass the key, for example `hotkey="F"`, to show it in the tooltip.
- The child must accept a ref and props; shadcn components and plain elements do. Wrap a popover trigger from the outside: `<Tip><PopoverTrigger render={<Button />} /></Tip>`.

### shadcn files with local edits

- `button.tsx` carries local font-size tweaks: when an install asks to overwrite it, set it aside and restore it afterwards.
- `command.tsx` matches the selected row with `data-[selected=true]:` because cmdk writes `data-selected="false"` on every other row; keep that edit if the component is re-added.
- `tooltip.tsx` is restyled light (popover colours, a ring and shadow, no arrow), and `kbd.tsx` drops the base-layer `kbd` border inside tooltips; keep both edits if either is re-added.
- New shadcn files sometimes import `cn` from `"cn"`; change it to `@/lib/utils`.

### Styling

`src/web/style.css` rules outside a layer beat Tailwind utilities. Element defaults live in `@layer base`; style shadcn components through their `className`, and keep plain CSS classes for app-specific layout.

## Running

`pnpm dev` serves the app with hot reload at http://127.0.0.1:5173. `pnpm build` then `pnpm start` serves the production build at http://127.0.0.1:4317.

Routes are TanStack Start file routes in `src/routes/`. The router plugin generates `src/routeTree.gen.ts`. Commit it, but don't edit it. The browser calls the server through the named functions in `src/*.functions.ts`, and `src/runtime.server.ts` owns the database and the analysis jobs.
