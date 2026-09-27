# API de verificação de números WhatsApp

Backend TypeScript para submeter lotes de números a uma fila Redis e verificar, de forma serializada e assíncrona, se cada número é resolvido por uma sessão do WhatsApp Web. Os resultados e o progresso ficam persistidos no PostgreSQL. Use-o somente para números que você está autorizado a consultar e em conformidade com os termos do WhatsApp e a legislação aplicável.

## Estrutura

```text
src/
├── config/        # validação centralizada das variáveis de ambiente
├── controllers/   # handlers HTTP
├── db/            # pool PostgreSQL e migração idempotente
├── lib/           # fila BullMQ
├── middleware/    # autenticação por chave de API
├── routes/        # rotas REST versionadas
├── services/      # cliente whatsapp-web.js e ciclo de sessão
├── workers/       # consumidor da fila
└── server.ts       # processo da API
```

## Dependências e decisões

- **Express + TypeScript**: API REST pequena e tipada.
- **BullMQ + Redis**: o endpoint de lote retorna imediatamente; o processo `worker` consome os trabalhos com concorrência `1`, protegendo a sessão WhatsApp.
- **PostgreSQL (`pg`)**: armazena trabalhos, resultados e estado/QR code da sessão.
- **whatsapp-web.js + Chromium**: fornece a resolução de IDs do WhatsApp Web. O QR é convertido em data URL base64 para consumo pelo cliente.
- **Helmet, CORS aberto e `x-api-key`**: a API pode ser chamada de qualquer domínio, mantendo autenticação por chave.

## Variáveis de ambiente

Copie o arquivo de exemplo e defina uma chave forte:

```bash
cp .env.example .env
```

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta HTTP, padrão `3000`. |
| `DATABASE_URL` | URL de conexão PostgreSQL. |
| `REDIS_URL` | URL do Redis usado pelo BullMQ. |
| `API_KEY` | Segredo de no mínimo 16 caracteres enviado em `x-api-key`. |
| `WHATSAPP_AUTH_PATH` | Diretório persistente das credenciais WhatsApp Web. |
| `MAX_BATCH_SIZE` | Máximo de números por lote; padrão `500`. |

## Executar localmente com Docker

1. Instale Docker Compose e crie `.env` como acima. Para o Compose fornecido, mantenha `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/whatsapp_verifier` e `REDIS_URL=redis://redis:6379`.
2. Inicie os serviços:

   ```bash
   docker compose up --build
   ```

3. Solicite o QR code. Copie o valor `qr_code` (uma data URL) para exibi-lo em um `<img src="...">` ou decodifique-o no seu frontend. Após escanear, aguarde `ready`:

   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/session -H 'x-api-key: change-me-to-a-long-random-value'
   ```

4. Envie um lote e guarde o `jobId`:

   ```bash
   curl -X POST http://localhost:3000/api/v1/verify/batch \
     -H 'content-type: application/json' -H 'x-api-key: change-me-to-a-long-random-value' \
     -d '{"numbers":["5511999999999","5511888888888"]}'
   ```

5. Consulte o progresso e, quando concluído, o relatório:

   ```bash
   curl http://localhost:3000/api/v1/verify/status/SEU_JOB_ID -H 'x-api-key: change-me-to-a-long-random-value'
   curl http://localhost:3000/api/v1/verify/results/SEU_JOB_ID -H 'x-api-key: change-me-to-a-long-random-value'
   ```

O volume `whatsapp_auth` preserva a autenticação entre reinícios locais. Para refazer a sessão, execute `docker compose down -v` (isso também apaga os dados locais).

## Contrato da API

Todos os endpoints `/api/v1` exigem `x-api-key`.

| Método e rota | Resposta |
| --- | --- |
| `POST /api/v1/verify/batch` | Recebe `{ "numbers": ["..."] }`, deduplica a lista e retorna `202` com `jobId`, total e estado `pending`. |
| `GET /api/v1/verify/status/:jobId` | Retorna estado `pending`, `processing`, `completed` ou `failed`, contadores e progresso 0–100. |
| `GET /api/v1/verify/results/:jobId` | Retorna o estado e cada resultado, inclusive falhas individuais. |
| `POST /api/v1/auth/session` | Retorna `initializing`, `qr_ready`, `authenticated`, `ready`, etc., e `qr_code` base64 quando disponível. |
| `GET /health` | Liveness probe sem autenticação. |

Números são normalizados removendo caracteres não numéricos e devem ser informados com país/DDD em formato compatível com E.164. Um erro em um número é gravado no resultado sem interromper o lote.

## Deploy no Render

1. Crie um **PostgreSQL** no Render e copie a *Internal Database URL* como `DATABASE_URL` nos dois serviços.
2. Crie um Redis gerenciado compatível (por exemplo Render Key Value, Upstash ou Redis Cloud) e defina sua URL TLS/Redis como `REDIS_URL` nos dois serviços.
3. Crie dois serviços a partir deste repositório com runtime **Docker**: um **Web Service** com comando `sh -c "node dist/db/migrate.js && node dist/server.js"`, e um **Background Worker** com `sh -c "node dist/db/migrate.js && node dist/workers/verification.worker.js"`.
4. Defina `NODE_ENV=production`, uma mesma `API_KEY` forte e as variáveis acima nos dois serviços. Configure `/health` como health check do Web Service.
5. Anexe um disco persistente ao worker e defina `WHATSAPP_AUTH_PATH` para um caminho dentro dele (por exemplo `/var/data/.wwebjs_auth`). Sem disco, cada novo deploy exigirá leitura do QR code novamente.
6. Mantenha somente uma réplica do worker por sessão de WhatsApp, pois `LocalAuth` e o navegador Chromium não devem ser usados simultaneamente por vários processos. Para escalar, isole cada sessão/tenant em um worker e diretório persistente próprios.

O `Dockerfile` instala Chromium e define `PUPPETEER_EXECUTABLE_PATH`, necessário para execução no container. O arquivo `render.yaml` é um ponto de partida para API e worker; configure nele ou no painel a URL do seu Redis gerenciado antes do primeiro deploy.

## Desenvolvimento sem Docker

Com PostgreSQL e Redis locais disponíveis:

```bash
npm install
npm run db:migrate
npm run dev
# em outro terminal
npm run dev:worker
```

## Operação e segurança

- CORS está propositalmente aberto para permitir chamadas do seu outro site; as rotas `/api/v1` continuam protegidas por `x-api-key`.
- Não exponha QR codes, resultados ou `API_KEY` em logs públicos.
- A migração é idempotente e pode ser executada por ambos os processos durante o boot.
- Monitore Redis, PostgreSQL e os logs do worker; uma sessão desconectada deixa os itens do lote registrados com erro para auditoria.

## Hospedar também na Vercel

A Vercel é adequada para hospedar a página inicial/documentação e a camada HTTP da API. Ao acessar a URL do projeto, a página mostra automaticamente se o endpoint `/api/health` está online e inclui exemplos de integração. As rotas `/api/v1/*` são atendidas pela função `api/[...path].ts`, enquanto `api/health.ts` responde ao teste de saúde da Vercel.

> **Limite importante da arquitetura:** não hospede o processo `worker` nem a sessão persistente do `whatsapp-web.js` somente em Vercel. Funções serverless são efêmeras, não executam um consumidor BullMQ continuamente e o disco local não é um local confiável para `LocalAuth`. Mantenha o **worker** e o volume persistente em Render (ou outro serviço de processos/containers), enquanto a Vercel hospeda a interface e pode receber os pedidos HTTP. Ambos devem apontar para o mesmo PostgreSQL e Redis externos.

### Passos na Vercel

1. Importe este repositório no painel Vercel. O diretório raiz é este projeto e não é necessário definir um comando de build customizado.
2. Em **Settings → Environment Variables**, defina `DATABASE_URL`, `REDIS_URL`, `API_KEY` e `MAX_BATCH_SIZE`. Use os mesmos `DATABASE_URL`, `REDIS_URL` e `API_KEY` do worker no Render.
3. CORS já está aberto por padrão, portanto qualquer domínio pode fazer requisições HTTP à API.
4. Faça o deploy. A raiz `/` mostrará a tela de estado e documentação; `/api/health` deve retornar JSON com `status: "ok"`.
5. Execute `npm run db:migrate` uma vez em um ambiente com acesso ao PostgreSQL, ou deixe o serviço API/worker do Render executar a migração no boot. Não faça a migração em toda invocação serverless.
#### Valores para copiar no painel da Vercel

| Nome | Valor a inserir na Vercel |
| --- | --- |
| `DATABASE_URL` | A URL completa do PostgreSQL partilhado com o Render, por exemplo `postgresql://USER:SENHA@HOST:5432/BANCO`. No Render, copie a **Internal Database URL**. |
| `REDIS_URL` | A URL completa do Redis partilhado com o worker, por exemplo `rediss://default:SENHA@HOST:PORT`. |
| `API_KEY` | Uma chave secreta de 16 ou mais caracteres. Gere-a com `openssl rand -hex 32` e use exatamente a mesma no serviço API e no worker. |
| `MAX_BATCH_SIZE` | `500` para o padrão, ou um número entre `1` e `5000`. |

Não cadastre `PORT` na Vercel: a plataforma controla a porta da função. `WHATSAPP_AUTH_PATH` também não é necessário na Vercel; ele é necessário no **worker Render**, com o valor `/var/data/.wwebjs_auth` e um disco persistente.


### Chamadas a partir de outro site

A opção mais segura é o backend do seu outro site chamar esta API e guardar `API_KEY` apenas como segredo de servidor. O exemplo da tela inicial e o abaixo usam esse padrão:

```ts
const response = await fetch('https://sua-api.vercel.app/api/v1/verify/batch', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.WHATSAPP_API_KEY!
  },
  body: JSON.stringify({ numbers: ['5511999999999'] })
});
```

Uma chamada diretamente do browser também é aceita porque CORS está aberto. Porém, como a rota exige `x-api-key`, use um endpoint proxy no backend do seu site para não expor a chave secreta no JavaScript público.
