# Eleições de oficiais · IPB Lavras

Aplicação para eleição presencial de presbíteros e diáconos com voto secreto por senha, contingência em papel e condução integral pela mesa.

## Estrutura

- `frontend/`: React 19 + Vite, publicado como arquivos estáticos no Nginx.
- `backend/`: NestJS, executado como serviço systemd na VPS.
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

O deploy de produção usa GitHub Actions, Hostinger VPS, Nginx e systemd. Cada `push` em `main` valida a aplicação, compila frontend e backend, aplica as migrations e ativa a nova release com health check e rollback da aplicação em caso de falha.

Veja o [passo a passo de deploy na Hostinger](docs/deploy-hostinger.md).
