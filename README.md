# pontesyfabrica

Serviço mínimo para o Render. Não roda nenhuma ferramenta da Fábrica.

- `GET /ponte` (WebSocket): o Termux conecta aqui, de saída. Autenticação com `Authorization: Bearer <SYNAPSE_TOKEN>`.
- `POST` em qualquer caminho fora de `/saude` (use `/a/mcp1/mcp`): MCP JSON-RPC. Aceita `/a/<agente>`, `/t/<token>` e `?token=` como o Synapse real.
- `GET /saude`: público; mostra se a Fábrica está online.

Toda `tools/call` vai pelo WebSocket até o Termux. `tools/list` e a missão do agente (`initialize`) também vêm da Fábrica real. Offline, a ponte responde com aviso claro e usa uma lista reserva de ferramentas.

## Variáveis (Render, Environment)

| Variável | Uso |
|---|---|
| `SYNAPSE_TOKEN` | Obrigatória, segredo. Mesmo valor do Termux. |
| `PONTE_TIMEOUT_MS` | Espera pela resposta do Termux; padrão 75000 (cobre o `aguardar`). |
| `HOSTS_PERMITIDOS` / `ORIGENS_PERMITIDAS` | Opcionais. |

## Subir

Repositório próprio: Blueprint com este `render.yaml`. Dentro do mesmo repositório da Fábrica: crie um Web Service manual com Root Directory `pontesyfabrica`, build `npm install --omit=dev`, start `node server.js`, health check `/saude`.

## Testar

`npm install` e `npm test` dentro desta pasta. O teste sobe o servidor e simula o Termux. Depois do deploy, confira `/saude` com o Termux ligado: `fabrica.online` deve ser `true`.

## Limites

- Plano free do Render dorme por inatividade. O cliente do Termux tenta reconectar com intervalo crescente (máx. 30 s), o que acorda o serviço, mas a primeira conexão pode levar cerca de 1 minuto.
- Só uma Fábrica por ponte: uma conexão nova substitui a anterior.
- Nada aqui foi executado em produção; valide com o teste e com `/saude`.