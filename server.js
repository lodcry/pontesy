// Ponte da Fábrica: serviço mínimo no Render. Não executa ferramenta nenhuma.
// /ponte (WebSocket, o Termux conecta aqui) e qualquer POST fora de /saude = MCP.
import http from 'node:http';
import { criarPonte } from './ponte.js';
import { criarMcp } from './mcp.js';
import { corsHeaders, tokenConfigurado } from './seguranca.js';
import { normalizar } from './requisicao.js';
import { responderJson } from './util.js';

const PORTA = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (!tokenConfigurado()) {
  console.error('ERRO: SYNAPSE_TOKEN não configurado. Configure-o como segredo no Environment do Render.');
  process.exit(1);
}

const ponte = criarPonte();
const mcp = criarMcp(ponte);

const servidor = http.createServer(async (req, res) => {
  const { pathname } = normalizar(req);
  const headers = corsHeaders(req);

  if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }

  try {
    if (pathname === '/saude' && (req.method === 'GET' || req.method === 'HEAD')) {
      return responderJson(res, {
        status: 'ok', servico: 'pontesyfabrica', fabrica: ponte.estado(), uptime_s: Math.round(process.uptime()),
      }, 200, headers);
    }

    if (req.method === 'POST') return await mcp.atender(req, res);

    if (pathname === '/mcp' || pathname === '/') {
      res.writeHead(405, { ...headers, Allow: 'POST' });
      return res.end();
    }

    res.writeHead(404, headers);
    res.end('não encontrado');
  } catch (erro) {
    if (!res.headersSent) responderJson(res, { erro: String(erro.message || erro) }, 500, headers);
    else if (!res.writableEnded) res.end();
  }
});

ponte.instalar(servidor);
servidor.keepAliveTimeout = 65000;
servidor.headersTimeout = 66000;

servidor.listen(PORTA, HOST, () => {
  console.log(`PonteSyFabrica: host=${HOST} porta=${PORTA} token=configurado`);
  console.log('Aguardando o Termux em /ponte (WebSocket) e o MCP por POST.');
});

process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
process.on('SIGINT', () => servidor.close(() => process.exit(0)));
process.on('unhandledRejection', m => console.error('Promessa rejeitada sem tratamento:', m?.message || m));
process.on('uncaughtException', e => console.error('Exceção não tratada:', e?.stack || e?.message || e));