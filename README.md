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

## Deploy no Render — guia completo

Esta aplicação precisa de **quatro** recursos no Render: PostgreSQL, Key Value (Redis), um Web Service (a API e a página) e um Background Worker (o WhatsApp). Crie todos na **mesma região**. Não publique somente o Web Service: sem o worker, os lotes ficam pendentes e nenhum QR code será gerado.

> **Custo e plano:** o worker precisa de disco persistente para conservar a sessão do WhatsApp. Escolha um plano de worker que permita anexar disco; serviços gratuitos/efêmeros não servem para essa sessão.

### 1. Criar PostgreSQL e encontrar `DATABASE_URL`

1. No [Dashboard do Render](https://dashboard.render.com/), clique em **New +** e escolha **PostgreSQL**.
2. Escolha um nome (por exemplo, `whatsapp-verifier-db`), a mesma região dos serviços e crie o banco.
3. Abra o banco criado. Na página **Info** ou **Connect**, localize **Internal Database URL** e copie o valor inteiro.
4. Esse valor é o `DATABASE_URL`. O formato é parecido com `postgresql://USUARIO:SENHA@HOST_INTERNO:5432/NOME_DO_BANCO`.

Use a **Internal Database URL** tanto no Web Service quanto no Background Worker. Ela funciona entre recursos do Render e é a URL certa para este deploy; não use a URL externa para esses dois serviços.

### 2. Criar Redis e encontrar `REDIS_URL`

1. Clique em **New +** e escolha **Key Value**. Esse é o Redis gerenciado do Render.
2. Crie-o na mesma região e abra o recurso criado.
3. Na página **Info** ou **Connect**, copie a **Internal Connection String** (ou **Internal Redis URL**, se esse for o nome exibido).
4. Esse valor é o `REDIS_URL`. Ele normalmente começa com `redis://` ou `rediss://`.

Copie a URL completa, sem aspas e sem espaços, para os dois serviços. **Não** use a URL REST do Key Value: BullMQ precisa da string Redis normal, no formato `redis://...`/`rediss://...`.

### 3. Gerar a chave da API

No seu computador, execute uma vez:

```bash
openssl rand -hex 32
```

Guarde o resultado. Ele será o valor de `API_KEY` nos dois serviços e no backend do seu outro site. Nunca coloque esse valor em código JavaScript público, commits ou screenshots.

### 4. Criar o Web Service (API e tela)

1. Clique em **New + → Web Service** e conecte este repositório GitHub.
2. Selecione a branch que contém este código e escolha **Docker** como runtime.
3. Em **Advanced**, defina o comando de início como:

   ```bash
   sh -c "node dist/db/migrate.js && node dist/server.js"
   ```

4. Em **Health Check Path**, informe `/health`.
5. Em **Environment**, crie exatamente estas variáveis:

   | Nome | Valor a preencher |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | A **Internal Database URL** copiada no passo 1. |
   | `REDIS_URL` | A **Internal Connection String** do Key Value copiada no passo 2. |
   | `API_KEY` | O resultado completo de `openssl rand -hex 32`. |
   | `MAX_BATCH_SIZE` | `500` (ou outro inteiro de `1` a `5000`). |

Não crie `PORT`: o Render fornece essa porta automaticamente. Não precisa definir `WHATSAPP_AUTH_PATH` no Web Service.

### 5. Criar o Background Worker (WhatsApp)

1. Clique em **New + → Background Worker**, conecte o **mesmo repositório**, selecione a mesma branch e runtime **Docker**.
2. Defina o comando de início:

   ```bash
   sh -c "node dist/db/migrate.js && node dist/workers/verification.worker.js"
   ```

3. Crie as variáveis abaixo. `DATABASE_URL`, `REDIS_URL`, `API_KEY` e `MAX_BATCH_SIZE` devem ter os **mesmos valores** usados no Web Service.

   | Nome | Valor a preencher |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | A mesma **Internal Database URL** do PostgreSQL. |
   | `REDIS_URL` | A mesma **Internal Connection String** do Key Value. |
   | `API_KEY` | A mesma chave usada no Web Service. |
   | `MAX_BATCH_SIZE` | O mesmo valor do Web Service, por exemplo `500`. |
   | `WHATSAPP_AUTH_PATH` | `/var/data/.wwebjs_auth` |

4. Em **Disks**, adicione um disco persistente, com ponto de montagem `/var/data` e pelo menos `1 GB`.
5. Deixe **apenas uma instância** desse worker para esta sessão. Duas instâncias tentam usar o mesmo WhatsApp Web e podem desconectar uma à outra.

### 6. Fazer deploy e conectar o WhatsApp

1. Faça deploy do Web Service e do worker e aguarde ambos ficarem como **Live**.
2. Abra a URL pública do Web Service. A página inicial testa `/health`; ela deve mostrar **Servidor a funcionar**.
3. Consulte a sessão com sua chave. Troque `SUA_URL_RENDER` e `SUA_API_KEY`:

   ```bash
   curl -X POST https://SUA_URL_RENDER/api/v1/auth/session \
     -H 'x-api-key: SUA_API_KEY'
   ```

4. Quando `status` for `qr_ready`, copie o valor de `qr_code` para a barra de endereço, ou use-o como `src` de uma imagem. No WhatsApp do telefone, abra **Dispositivos conectados → Conectar dispositivo** e leia o QR.
5. Repita a chamada até aparecer `status: "ready"`. Só então envie lotes para `/api/v1/verify/batch`.

Se o QR nunca aparece, abra os logs do **Background Worker**: é ele, e não o Web Service, que inicia Chromium e a sessão do WhatsApp. Se uma nova leitura for necessária, remova somente a pasta `.wwebjs_auth` do disco com cuidado ou conecte novamente; não apague o disco sem necessidade.

### Alternativa: Blueprint

O arquivo [`render.yaml`](render.yaml) descreve os recursos para um Blueprint. Você pode usar **New + → Blueprint**, selecionar o repositório e revisar os nomes/planos antes de criar. Depois da criação, abra o worker e confirme `API_KEY`: por segurança, o Blueprint não copia automaticamente o segredo gerado no Web Service para o worker; defina exatamente a mesma chave nos dois. A criação manual acima é a forma mais simples de enxergar e copiar cada URL.

O `Dockerfile` já instala Chromium e define `PUPPETEER_EXECUTABLE_PATH`, necessário para `whatsapp-web.js` no container.

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

### Chamadas a partir de outro site

A opção mais segura é o backend do seu outro site chamar esta API e guardar `API_KEY` apenas como segredo de servidor. O exemplo da tela inicial e o abaixo usam esse padrão:

```ts
const response = await fetch('https://SUA_URL_RENDER/api/v1/verify/batch', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.WHATSAPP_API_KEY!
  },
  body: JSON.stringify({ numbers: ['5511999999999'] })
});
```

Uma chamada diretamente do browser também é aceita porque CORS está aberto. Porém, como a rota exige `x-api-key`, use um endpoint proxy no backend do seu site para não expor a chave secreta no JavaScript público.
