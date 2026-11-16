// Ponte WebSocket: o Termux (Fábrica real) conecta DE SAÍDA em /ponte; o MCP repassa pedidos até ele.
// Mensagens Render -> Termux: { id, tipo: 'chamar'|'listar'|'instrucoes', ... }
// Mensagens Termux -> Render: { id, resultado } ou { id, erro }
import { WebSocketServer } from 'ws';
import { tokenValido, registrarFalha, excedeuFalhas } from './seguranca.js';
import { sanitizar } from './util.js';

const TIMEOUT_MS = Number(process.env.PONTE_TIMEOUT_MS) || 75000;
const PING_MS = 25000;

export function criarPonte() {
  let socket = null;
  let desde = null;
  let cacheFerramentas = null;
  let proximoId = 0;
  const pendentes = new Map();

  const online = () => !!socket && socket.readyState === socket.OPEN;
  const estado = () => ({ online: online(), desde, pendentes: pendentes.size });

  function limparPendentes(motivo) {
    for (const [id, p] of pendentes) {
      clearTimeout(p.timer);
      p.reject(new Error(motivo));
      pendentes.delete(id);
    }
  }

  function pedir(tipo, dados = {}, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!online()) {
        reject(new Error('Fábrica offline no momento. O Termux precisa estar ligado e conectado à ponte.'));
        return;
      }
      const id = 'c' + (++proximoId);
      const timer = setTimeout(() => {
        pendentes.delete(id);
        reject(new Error('A Fábrica não respondeu dentro do tempo limite.'));
      }, timeoutMs);
      timer.unref();
      pendentes.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, tipo, ...dados }));
      } catch (erro) {
        clearTimeout(timer);
        pendentes.delete(id);
        reject(erro);
      }
    });
  }

  const chamarFabrica = args => pedir('chamar', { args });

  async function listarFerramentas() {
    try {
      const lista = await pedir('listar', {}, 10000);
      if (Array.isArray(lista) && lista.length) cacheFerramentas = lista;
    } catch {}
    return cacheFerramentas;
  }

  async function instrucoes(agente) {
    try {
      const t = await pedir('instrucoes', { agente }, 10000);
      return typeof t === 'string' ? t : null;
    } catch { return null; }
  }

  function anexar(ws) {
    if (socket && socket !== ws) {
      const antigo = socket;
      socket = null;
      limparPendentes('Conexão da Fábrica substituída por uma nova.');
      try { antigo.close(4000, 'substituida'); } catch {}
    }
    socket = ws;
    desde = new Date().toISOString();
    ws.vivo = true;

    ws.on('pong', () => { ws.vivo = true; });
    ws.on('message', dados => {
      ws.vivo = true;
      let msg;
      try { msg = JSON.parse(dados.toString()); } catch { return; }
      const p = msg && pendentes.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pendentes.delete(msg.id);
      if (msg.erro) p.reject(Object.assign(new Error(sanitizar(msg.erro)), { deFabrica: true }));
      else p.resolve(msg.resultado);
    });
    ws.on('close', () => {
      if (socket === ws) {
        socket = null;
        desde = null;
        limparPendentes('A Fábrica (Termux) desconectou antes de responder.');
      }
    });
    ws.on('error', () => {});
  }

  function instalar(servidorHttp) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

    servidorHttp.on('upgrade', (req, sock, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ponte') { sock.destroy(); return; }
      if (excedeuFalhas(req)) { sock.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); sock.destroy(); return; }
      const auth = String(req.headers.authorization || '');
      const doCabecalho = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!tokenValido(doCabecalho || url.searchParams.get('token') || '')) {
        registrarFalha(req);
        sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        sock.destroy();
        return;
      }
      wss.handleUpgrade(req, sock, head, ws => {
        anexar(ws);
        console.log('[ponte] Fábrica (Termux) conectada.');
      });
    });

    const batida = setInterval(() => {
      if (!socket) return;
      if (socket.vivo === false) { try { socket.terminate(); } catch {} return; }
      socket.vivo = false;
      try { socket.ping(); } catch {}
    }, PING_MS);
    batida.unref();

    return wss;
  }

  return { instalar, chamarFabrica, listarFerramentas, instrucoes, estado, online };
}