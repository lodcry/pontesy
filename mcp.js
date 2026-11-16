// Transporte MCP (JSON-RPC sobre HTTP). Não executa nada: toda ação segue pela ponte até o Termux.
import { corsHeaders, hostPermitido, autenticadoHttp, registrarFalha, excedeuFalhas } from './seguranca.js';
import { responderJson, jsonRpcErro, lerCorpo, sanitizar } from './util.js';

const PROTOCOLO_MCP = '2025-06-18';
const SUPORTADAS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const DESCRICAO =
  'Ponte da Fábrica: encaminha toda ação para o Synapse real no Termux. ' +
  'Use os mesmos campos do Synapse (acao=entrar, listar, executar, projeto...). Comece com acao=entrar.';

const FERRAMENTA_RESERVA = [{
  name: 'synapse',
  description: DESCRICAO,
  inputSchema: {
    type: 'object',
    properties: { acao: { type: 'string', description: 'Qualquer ação aceita pelo Synapse real.' } },
    required: ['acao'],
    additionalProperties: true,
  },
}];

const agenteFixo = req => String(req.headers['x-agente'] || '').replace(/[^\w.-]/g, '').slice(0, 40);

const saida = (id, texto, isError = false) => ({
  jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(texto).slice(0, 8192) }], isError },
});

export function criarMcp(ponte) {
  async function atender(req, res) {
    const headers = corsHeaders(req);

    if (!hostPermitido(req)) return responderJson(res, { erro: 'Host não permitido.' }, 403, headers);

    if (!autenticadoHttp(req)) {
      registrarFalha(req);
      if (excedeuFalhas(req)) {
        return responderJson(res, { erro: 'Muitas tentativas sem autorização. Aguarde alguns minutos.' }, 429, { ...headers, 'Retry-After': '600' });
      }
      return responderJson(res, { erro: 'Não autorizado.' }, 401, { ...headers, 'WWW-Authenticate': 'Bearer realm="PonteSyFabrica"' });
    }

    let mensagem;
    try { mensagem = await lerCorpo(req); }
    catch (erro) { return responderJson(res, jsonRpcErro(null, -32700, 'JSON inválido ou corpo inválido.', erro.message), 400, headers); }

    if (!mensagem || Array.isArray(mensagem) || mensagem.jsonrpc !== '2.0') {
      return responderJson(res, jsonRpcErro(mensagem?.id, -32600, 'Requisição JSON-RPC inválida.'), 400, headers);
    }

    const { id, method, params = {} } = mensagem;
    if (typeof method !== 'string') return responderJson(res, jsonRpcErro(id, -32600, 'O método JSON-RPC é obrigatório.'), 400, headers);

    if (method.startsWith('notifications/')) { res.writeHead(202, headers); return res.end(); }

    if (method === 'initialize') {
      const versao = SUPORTADAS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLO_MCP;
      const fixo = agenteFixo(req);
      const real = ponte.online() ? await ponte.instrucoes(fixo) : null;
      const texto = real || (ponte.online()
        ? 'Ponte conectada à Fábrica. Chame acao=entrar para receber sua missão.'
        : 'Ponte ativa, mas a Fábrica (Termux) está offline no momento.');
      return responderJson(res, {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: versao,
          capabilities: { tools: { listChanged: false } },
          instructions: texto,
          serverInfo: { name: 'pontesyfabrica', title: 'Ponte da Fábrica', version: '1.1.0' },
        },
      }, 200, { ...headers, 'MCP-Protocol-Version': versao });
    }

    if (method === 'ping') return responderJson(res, { jsonrpc: '2.0', id, result: {} }, 200, headers);

    if (method === 'tools/list') {
      const lista = (await ponte.listarFerramentas()) || FERRAMENTA_RESERVA;
      return responderJson(res, { jsonrpc: '2.0', id, result: { tools: lista } }, 200, headers);
    }

    if (method === 'tools/call') {
      if (params.name !== 'synapse') return responderJson(res, jsonRpcErro(id, -32602, 'Ferramenta MCP desconhecida.'), 200, headers);
      try {
        const args = { ...(params.arguments || {}) };
        const fixo = agenteFixo(req);
        if (fixo) args.agente = fixo;
        const r = await ponte.chamarFabrica(args);
        return responderJson(res, saida(id, typeof r === 'string' ? r : JSON.stringify(r, null, 2)), 200, headers);
      } catch (erro) {
        const msg = erro.deFabrica
          ? erro.message
          : `Falhou: ${sanitizar(erro.message)}. Onde: ponte → Fábrica (Termux). Como corrigir: confirme que o Termux está ligado e conectado à ponte e tente de novo.`;
        return responderJson(res, saida(id, msg, true), 200, headers);
      }
    }

    return responderJson(res, jsonRpcErro(id, -32601, `Método não encontrado: ${method}`), 200, headers);
  }

  return { atender };
}