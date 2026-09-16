# Deploy na hospedagem gerenciada da Hostinger

A produção usa duas **Node.js Web Apps** do mesmo repositório, gerenciadas pelo
hPanel. Não há VPS, SSH, Nginx, systemd ou credenciais de servidor.

| Aplicação | Domínio | Tipo |
| --- | --- | --- |
| Frontend | `eleicoes.iplavras.org.br` | Vite/React estático |
| Backend | `api-eleicoes.iplavras.org.br` | NestJS persistente |

A integração nativa entre Hostinger e GitHub observa a branch `main`. Cada
`push` inicia uma nova compilação e publicação. O workflow `CI` do GitHub também
executa typecheck, testes unitários e build, mas não recebe credenciais de
produção.

## Pré-requisitos do plano

A conta Hostinger precisa ter plano Business Web Hosting ou Cloud com suporte a
Node.js Web Apps. No hPanel, a opção esperada é:

```text
Websites > Adicionar site > Deploy Web App / Node.js Web App
```

Use Node.js `22.x` nas duas aplicações.

### Limitação do acesso compartilhado

Mesmo com papel Admin, um usuário com acesso compartilhado não pode adicionar
um novo site no plano. O titular da conta precisa criar inicialmente as duas
Node.js Web Apps. Depois disso, deve compartilhar o **plano de hospedagem** — não
somente o domínio — com o responsável técnico, que poderá administrar os sites
e suas configurações.

Como o repositório é público, o titular pode colar diretamente
`https://github.com/zeesterx/ipb-election`; não precisa ter acesso à conta
GitHub do projeto para concluir essa criação inicial.

## 1. Criar a API

No hPanel da conta responsável pela hospedagem:

1. Adicione uma nova **Node.js Web App**.
2. Escolha **Import Git Repository**.
3. Conecte ao repositório `zeesterx/ipb-election`, branch `main`.
4. Selecione NestJS; se não for detectado, selecione `Other`.
5. Mantenha a raiz do repositório como diretório raiz, pois o lockfile e os
   workspaces estão nela.
6. Use estas configurações:

```text
Node.js:          22.x
Build command:    npm run build:backend
Start command:    npm run start:backend
Output directory: backend/dist
Entry file:       backend/dist/main.js
```

O `start:backend` executa as migrations idempotentes antes de iniciar a API.
Cadastre no painel da API:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://USUARIO:SENHA@POOLER:5432/postgres?sslmode=require
SUPABASE_URL=https://PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=CHAVE_PUBLISHABLE_OU_ANON
VOTER_JWT_SECRET=SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
CORS_ORIGIN=https://eleicoes.iplavras.org.br
PUBLIC_VOTER_URL=https://eleicoes.iplavras.org.br
ADMIN_EMAILS=EMAIL_ADMINISTRADOR
AUTH_DEV_BYPASS=false
```

Gere `VOTER_JWT_SECRET` com `openssl rand -hex 32`. A conexão da aplicação com
os dados continua sendo PostgreSQL direto; a API do Supabase é usada somente
para autenticação administrativa.

Conclua o primeiro deploy em um domínio temporário e valide:

```text
https://DOMINIO-TEMPORARIO/api/health
```

Depois conecte `api-eleicoes.iplavras.org.br`. A Hostinger cuida do certificado
SSL e mostra no fluxo os registros DNS necessários.

## 2. Criar o frontend

Adicione uma segunda **Node.js Web App**, aponte para o mesmo repositório e a
mesma branch e selecione Vite/React:

```text
Node.js:          22.x
Build command:    npm run build:frontend
Output directory: frontend/dist
```

Mantenha novamente a raiz do repositório como diretório raiz. Cadastre:

```dotenv
VITE_API_URL=https://api-eleicoes.iplavras.org.br/api
VITE_SUPABASE_URL=https://PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=CHAVE_PUBLISHABLE_OU_ANON
VITE_DEV_ADMIN=false
```

Variáveis `VITE_*` fazem parte do JavaScript entregue ao navegador e, portanto,
não podem conter segredos. Conecte `eleicoes.iplavras.org.br` depois do primeiro
build.

## 3. GitHub e atualizações

A Hostinger permite uma conta GitHub conectada por plano. Autorize nessa conta
o acesso ao repositório público `zeesterx/ipb-election`. Depois de conectar as
duas aplicações à `main`, cada push inicia automaticamente o redeploy de ambas.

Não são necessários GitHub Secrets de SSH. As credenciais de produção devem
existir somente em **Environment Variables** da aplicação da API no hPanel.

## 4. Checklist final

1. `https://api-eleicoes.iplavras.org.br/api/health` retorna `{"status":"ok"}`.
2. `https://eleicoes.iplavras.org.br` abre a tela de senha.
3. Uma senha inexistente mostra `Senha inválida.`.
4. `/admin` redireciona para login quando não há sessão.
5. O administrador autorizado consegue entrar.
6. Recarregar uma rota interna do admin não devolve 404.
7. Um novo push na `main` aparece nos históricos de deploy das duas aplicações.

## Se o build falhar

- confirme Node.js `22.x`;
- confirme que o diretório raiz é a raiz do repositório;
- confira os comandos e diretórios exatamente como listados;
- confira as Environment Variables no app correto;
- veja o log da implantação em `Deployments` no hPanel;
- em erro de banco, confira `DATABASE_URL`, SSL e liberação de rede do Supabase.
