# kb

A knowledge base for teams — write, organize and find company knowledge in one place.

## Phát triển local

Yêu cầu: Node ≥ 22 và pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev        # web http://localhost:3000 + collab ws://localhost:3001
pnpm lint | pnpm typecheck | pnpm test | pnpm build
pnpm format     # prettier
```

Cấu trúc: `apps/web` (Next.js App Router, `output: "standalone"`), `apps/collab` (Hocuspocus), `packages/config` (tsconfig, ESLint, Prettier dùng chung). Kế hoạch: [`docs/PLAN.md`](docs/PLAN.md) · Quy tắc agent: [`AGENTS.md`](AGENTS.md).
