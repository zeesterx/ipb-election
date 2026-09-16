# Deploy contínuo na Hostinger

Este projeto usa o mesmo arranjo do projeto CBB: frontend estático no Nginx,
API NestJS mantida pelo systemd e Supabase gerenciado. É necessário um **VPS da
Hostinger** (ou plano com processo Node persistente); hospedagem compartilhada
comum não executa este backend.

Cada `push` na branch `main` executa a pipeline de produção. Ela valida e
compila a aplicação, envia somente os artefatos necessários por SSH, instala as
dependências de produção, aplica as migrations, ativa a nova versão, reinicia a
API e consulta `/api/health`. Se a API nova não responder, o link volta para a
versão anterior.

## 1. Informações necessárias

- IP ou hostname da VPS;
- porta SSH (normalmente `22`);
- usuário SSH de deploy;
- chave SSH privada exclusiva para o GitHub Actions;
- chave pública correspondente, cadastrada em `authorized_keys` na VPS;
- linha `known_hosts` da VPS, conferida pelo fingerprint;
- domínio do frontend, por exemplo `eleicoes.dominio.com`;
- domínio da API, por exemplo `api-eleicoes.dominio.com`;
- URL PostgreSQL do pooler do Supabase;
- URL e chave publishable/anon do Supabase;
- e-mails que poderão administrar a eleição.

Não envie a senha do banco ou a chave SSH em mensagens, issues ou arquivos do
repositório. Cadastre-as nos locais indicados abaixo.

## 2. DNS

Crie dois registros `A`, ambos apontando para o IP público da VPS:

```text
eleicoes.dominio.com       -> IP_DA_VPS
api-eleicoes.dominio.com   -> IP_DA_VPS
```

Na Hostinger, permita no firewall as portas SSH, `80` e `443`.

## 3. Preparação única da VPS

Entre inicialmente com um usuário com `sudo` e instale Node 22, Nginx e Certbot:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx curl
node --version
npm --version
```

Se esta for a mesma VPS do CBB, confira primeiro `node --version`. Node 20.19 ou
mais recente também atende este backend; nesse caso não é necessário trocar a
versão global e afetar o outro serviço.

Crie um usuário para o GitHub publicar e outro, sem login, para executar a API:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo adduser --system --group --home /opt/ipb-election ipbelection
sudo usermod -aG ipbelection deploy
sudo chown deploy:ipbelection /opt/ipb-election
sudo chmod 755 /opt/ipb-election
sudo install -d -o deploy -g deploy -m 755 /opt/ipb-election/releases
sudo install -d -o root -g ipbelection -m 750 /opt/ipb-election/shared
```

Cadastre a chave pública de deploy:

```bash
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudoedit /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Permita ao usuário de deploy reiniciar somente este serviço:

```bash
sudo visudo -f /etc/sudoers.d/ipb-election-deploy
```

Conteúdo:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart ipb-election
```

## 4. Ambiente secreto do backend

Crie `/opt/ipb-election/shared/backend.env` na VPS:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://USUARIO:SENHA@POOLER:5432/postgres?sslmode=require
SUPABASE_URL=https://PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=CHAVE_PUBLISHABLE_OU_ANON
VOTER_JWT_SECRET=SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
CORS_ORIGIN=https://eleicoes.dominio.com
PUBLIC_VOTER_URL=https://eleicoes.dominio.com
ADMIN_EMAILS=admin@dominio.com
AUTH_DEV_BYPASS=false
```

Gere o segredo dos eleitores com `openssl rand -hex 32`. Depois proteja o
arquivo e confirme que o usuário `deploy`, membro do grupo, consegue lê-lo:

```bash
sudo chown root:ipbelection /opt/ipb-election/shared/backend.env
sudo chmod 640 /opt/ipb-election/shared/backend.env
sudo -u deploy test -r /opt/ipb-election/shared/backend.env
```

`DATABASE_URL` é usada pelo backend por PostgreSQL direto. A API do Supabase é
usada somente para autenticação administrativa, conforme a arquitetura do
projeto.

## 5. systemd e Nginx

Obtenha uma cópia temporária dos arquivos públicos de infraestrutura:

```bash
git clone --depth 1 https://github.com/zeesterx/ipb-election.git /tmp/ipb-election-bootstrap
cd /tmp/ipb-election-bootstrap
```

Copie `deploy/ipb-election.service` para a VPS:

```bash
sudo cp deploy/ipb-election.service /etc/systemd/system/ipb-election.service
sudo systemctl daemon-reload
sudo systemctl enable ipb-election
```

Copie `deploy/nginx.conf.example`, troque os dois domínios e habilite o site:

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/ipb-election
sudoedit /etc/nginx/sites-available/ipb-election
sudo ln -s /etc/nginx/sites-available/ipb-election /etc/nginx/sites-enabled/ipb-election
sudo nginx -t
sudo systemctl reload nginx
```

Depois que o DNS estiver propagado, habilite HTTPS:

```bash
sudo certbot --nginx \
  -d eleicoes.dominio.com \
  -d api-eleicoes.dominio.com
```

O primeiro deploy criará `/opt/ipb-election/current`; antes dele, o frontend
pode responder `404` e o serviço ainda não deve estar iniciado.

## 6. GitHub Environment

Em `Settings > Environments`, crie o environment `production`. Em seguida,
cadastre estes **Environment secrets**:

| Secret | Conteúdo |
| --- | --- |
| `HOSTINGER_SSH_HOST` | IP ou hostname da VPS |
| `HOSTINGER_SSH_PORT` | Porta SSH, normalmente `22` |
| `HOSTINGER_SSH_USER` | `deploy` |
| `HOSTINGER_SSH_PRIVATE_KEY` | chave privada completa, incluindo BEGIN/END |
| `HOSTINGER_SSH_KNOWN_HOSTS` | linha `known_hosts` verificada da VPS |

Cadastre também estas **Environment variables** (não são segredos; o Vite as
incorpora no JavaScript público):

| Variable | Exemplo |
| --- | --- |
| `VITE_API_URL` | `https://api-eleicoes.dominio.com/api` |
| `VITE_SUPABASE_URL` | `https://PROJETO.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | chave publishable/anon do projeto |

Para obter a linha `known_hosts`, use `ssh-keyscan -p PORTA -H HOST`, mas confira
o fingerprint resultante com a chave exibida no console da VPS antes de salvar.

## 7. Primeiro deploy e atualizações

Faça `push` para `main` ou abra `Actions > Deploy production > Run workflow`.
Depois confira:

```bash
curl https://api-eleicoes.dominio.com/api/health
sudo systemctl status ipb-election
sudo journalctl -u ipb-election -n 100 --no-pager
```

Daí em diante, cada `push` em `main` publica automaticamente. O frontend e o
backend pertencem à mesma release, evitando que versões incompatíveis sejam
misturadas durante a atualização.

## Diagnóstico rápido

- pipeline para antes do upload: faltam Variables/Secrets no environment;
- `Permission denied` no SSH: revise usuário, chave e `authorized_keys`;
- falha ao reiniciar: revise `/etc/sudoers.d/ipb-election-deploy`;
- migration falha: confira `DATABASE_URL`, SSL e acesso de rede ao Supabase;
- health check falha: use `journalctl` e confira a porta `3000`;
- front abre, mas não acessa a API: confira `VITE_API_URL` e `CORS_ORIGIN`;
- rota recarregada retorna 404: confirme o `try_files` do Nginx.
