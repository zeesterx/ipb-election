# Eleições de oficiais · IPB Lavras

Aplicação para eleição presencial de presbíteros e diáconos com voto secreto por senha, contingência em papel e condução integral pela mesa.

## Estrutura

- `frontend/`: React 19 + Vite, pronto para Cloudflare Pages.
- `backend/`: NestJS, pronto para contêiner no CapRover.
- `supabase/migrations/`: esquema PostgreSQL acessado diretamente pelo backend.
- `tests/e2e/`: cenários Playwright móveis, administrativos e de regras.
- `docs/regras-v2-validacao.md`: especificação funcional breve e atual.

## Executar localmente

1. Copie e preencha `backend/.env.example` e `frontend/.env.example`.
2. Execute `npm install`.
3. Aplique o banco com `npm run migrate`.
4. Inicie tudo com `npm run dev`.

Comandos de validação:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

O modo `AUTH_DEV_BYPASS`/`VITE_DEV_ADMIN` deve permanecer desativado fora dos testes E2E. O painel usa Supabase Auth e o backend ainda confere se o e-mail autenticado está na lista `ADMIN_EMAILS`. Os dados da eleição passam exclusivamente pela API NestJS e pela conexão PostgreSQL.

## Publicação

No Cloudflare Pages, configure a raiz de build como `frontend`, o comando `npm run build` e o diretório `dist`. Defina `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_DEV_ADMIN=false`.

No CapRover, use o `captain-definition` da raiz e configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VOTER_JWT_SECRET`, `CORS_ORIGIN`, `PUBLIC_VOTER_URL`, `ADMIN_EMAILS` e `AUTH_DEV_BYPASS=false`. A imagem aplica a migração idempotente antes de iniciar a API.
