# Eleições de oficiais · IPB Lavras

Aplicação para eleição presencial de presbíteros e diáconos com voto secreto por senha, contingência em papel e condução integral pela mesa.

## Estrutura

- `frontend/`: React 19 + Vite, publicado como aplicação gerenciada na Hostinger.
- `backend/`: NestJS, executado como Node.js Web App gerenciado na Hostinger.
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

O deploy de produção usa duas Node.js Web Apps gerenciadas pela Hostinger, conectadas à branch `main`: uma para o frontend e outra para a API. A integração nativa da Hostinger publica cada push; o GitHub Actions valida typecheck, testes e build sem receber segredos de produção.

Veja o [passo a passo de deploy na Hostinger](docs/deploy-hostinger.md).
