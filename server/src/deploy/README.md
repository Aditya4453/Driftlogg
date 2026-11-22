# Deployment Error Pipeline

Statically analyzes repositories and predicts deployment failures across **Render**, **Vercel**, and **Docker** with zero framework assumptions.

## Architecture

The pipeline consists of 5 modular stages:

```
                  ┌──────────────────────────────┐
                  │ Stage 1: Ingest (Lockfile)   │
                  └──────────────┬───────────────┘
                                 │
                   RepoSnapshot (Immutable Context)
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
   ┌───────────────────────────┐   ┌───────────────────────────┐
   │ Stage 2: Config & Secrets │   │ Stage 3: Code Traps (AST) │
   └─────────────┬─────────────┘   └─────────────┬─────────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Stage 4: Boot & Health Sim   │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Stage 5: Gated Scoring & Plan│
                  └──────────────────────────────┘
```

1. **Stage 1 (Ingest)**: Pins the commit SHA, fetches the tree, classifies target and app shape before fetching content, skips lockfiles/binaries/node_modules, and produces the single immutable `RepoSnapshot`.
2. **Stage 2 (Config & Secrets)**: Detects committed `.env` files, credential leaks, client-prefix secret exposure (`VITE_STRIPE_SECRET`), AST-based `.env.example` parity, `engines.node`, and platform config. Runs concurrently with Stage 3.
3. **Stage 3 (Code Traps)**: Resolves case-sensitive imports against the exact case-preserved tree, validates Render port & host bindings, flags production `http://localhost` calls, checks CORS credentials traps, and flags ephemeral disk writes. Runs concurrently with Stage 2.
4. **Stage 4 (Boot & Health Simulation)**: Traces entry point execution, verifies health check routes against `render.yaml` `healthCheckPath`, checks for ORM migrations, and checks database SSL options.
5. **Stage 5 (Scoring & Fix Plan)**: Evaluates gated scores, applies hard blocker caps, and generates an ordered fix plan with valid unified diffs grouped by file.

---

## Schemas

### 1. `RepoSnapshot` Schema

The single immutable context passed to every stage:

| Field | Type | Description |
|---|---|---|
| `source` | `object` | Source descriptor `{ type: 'github'\|'local'\|'files', owner, repo, ... }` |
| `ref` | `string` | Pinned 40-character hex commit SHA |
| `tree` | `Array<TreeEntry>` | Exact case-preserved tree paths (never lowercased) |
| `files` | `Map<string, FileRecord>` | Exact case path mapping to `{ content, status: 'ok'\|'skipped'\|'failed', reason }` |
| `target` | `string` | Target cloud platform: `'render'` \| `'vercel'` \| `'docker'` \| `'railway'` \| `'all'` |
| `appShape` | `string` | Application topology: `'frontend-spa'` \| `'backend-api'` \| `'monorepo'` \| `'containerized'` \| `'fullstack-next'` |
| `packageManager` | `string` | Detected package manager: `'npm'` \| `'pnpm'` \| `'yarn'` \| `'bun'` |
| `workspaces` | `string[]` | Root directories for detected monorepo packages |
| `completeness` | `object` | `{ truncated: boolean, skippedCount: number, failedCount: number, warnings: string[], coverage: number }` |

**Methods:**
- `snapshot.hasFile(path)`: Exact case match check.
- `snapshot.findCaseMismatch(path)`: Detects if a file exists under different casing.
- `snapshot.getFile(path)`: Returns the file record.
- `snapshot.getContent(path)`: Returns UTF-8 file content or `null`.
- `snapshot.getAST(path)`: Shared AST cache parsed via `@babel/parser`.
- `snapshot.getJSON(path)`: Shared JSON parse cache.
- `snapshot.findFiles(matcher)`: Predicate or regex search across tree entries.

---

### 2. `Finding` Schema

Every finding follows this strict specification:

```typescript
interface Finding {
  ruleId: string;              // Unique rule identifier (e.g. 'RENDER_LISTEN_HARDCODED_PORT')
  stage: 'ingest' | 'config' | 'code' | 'boot' | 'scoring';
  severity: 'blocker' | 'warning' | 'info';
  confidence: 'confirmed' | 'likely' | 'advisory';
  file: string;                // Exact path in tree, or 'repo'
  line: number;                // 1-indexed line number
  snippet: string;             // Code or config excerpt
  platform: 'render' | 'vercel' | 'docker' | 'all';
  message: string;             // Human-readable explanation
  fix: {
    description: string;       // Instructions to resolve
    patch: string;             // Valid unified diff (--- a/... +++ b/...)
  } | null;
}
```

---

### 3. Gated Scoring Rules

1. **Hard Blocker Gate**: Any `confirmed` `blocker` caps the score at **40** and sets the verdict strictly to **`will-fail`**.
2. **Likely Issues**: Issues with confidence `likely` subtract weighted points and can result in **`needs-fixes`** (41–79), but can **never** trigger `will-fail` alone.
3. **Advisory Issues**: Issues with confidence `advisory` lower the overall coverage percentage, but **never** downgrade the deployment verdict.
4. **Ready Verdict**: If there are no blockers and the score is $\ge 80$, the verdict is **`ready`**.

---

## Usage

```javascript
import { runDeploymentErrorPipeline } from './deploy/index.js';

const report = await runDeploymentErrorPipeline('https://github.com/owner/my-service', {
  token: process.env.GITHUB_TOKEN,
  onTrace: (line) => console.log(line),
});

console.log(`Verdict: ${report.verdict} (${report.score}/100)`);
console.log(`Coverage: ${report.coverage}%`);
console.log(`Findings: ${report.findings.length}`);
console.log(report.fixPlan.summary);
```

