// Túnel de páginas: o Termux conecta DE SAÍDA em /tunel; GET /p/<slug>/... é repassado até ele.
// Só passa GET/HEAD. Quem decide o que é público é o Termux (docas marcadas como publicas).
import { WebSocketServer } from 'ws';
import { tokenValido, registrarFalha, excedeuFalhas } from './seguranca.js';

const TIMEOUT_MS = Number(process.env.TUNEL_TIMEOUT_MS) || 20000;
const MAX_PENDENTES = 20;
const PING_MS = 25000;
const HEADERS_OK = ['content-type', 'etag', 'last-modified', 'content-language', 'location'];

export function criarTunel() {
  let socket = null;
  let desde = null;
  let proximo = 0;
  const pendentes = new Map();
  const online = () => !!socket && socket.readyState === socket.OPEN;
  const estado = () => ({ online: online(), desde, pendentes: pendentes.size });

  function limpar(motivo) {
    for (const [id, p] of pendentes) {
      clearTimeout(p.timer);
      p.reject(Object.assign(new Error(motivo), { codigo: 502 }));
      pendentes.delete(id);
    }
  }

  function pedir(dados) {
    return new Promise((resolve, reject) => {
      if (!online()) return reject(Object.assign(new Error('offline'), { codigo: 503 }));
      if (pendentes.size >= MAX_PENDENTES) return reject(Object.assign(new Error('ocupado'), { codigo: 429 }));
      const id = 't' + (++proximo);
      const timer = setTimeout(() => {
        pendentes.delete(id);
        reject(Object.assign(new Error('tempo'), { codigo: 504 }));
      }, TIMEOUT_MS);
      timer.unref();
      pendentes.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, tipo: 'http', ...dados })); }
      catch (e) { clearTimeout(timer); pendentes.delete(id); reject(e); }
    });
  }

  function anexar(ws) {
    if (socket && socket !== ws) {
      const antigo = socket;
      socket = null;
      limpar('substituida');
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
      if (msg.erro) p.reject(Object.assign(new Error('erro na fabrica'), { codigo: 502 }));
      else p.resolve(msg.resultado || {});
    });
    ws.on('close', () => {
      if (socket === ws) { socket = null; desde = null; limpar('desconectou'); }
    });
    ws.on('error', () => {});
  }

  function instalar(servidorHttp) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
    servidorHttp.on('upgrade', (req, sock, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/tunel') return;
      if (excedeuFalhas(req)) { sock.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); sock.destroy(); return; }
      const auth = String(req.headers.authorization || '');
      const doCabecalho = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!tokenValido(doCabecalho)) {
        registrarFalha(req);
        sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        sock.destroy();
        return;
      }
      wss.handleUpgrade(req, sock, head, ws => {
        anexar(ws);
        console.log('[tunel] Termux conectado.');
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

  function texto(res, headers, status, msg) {
    res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg);
  }

  async function atender(req, res, pathname, headers) {
    const m = pathname.match(/^\/p\/([a-z0-9][a-z0-9-]*)(\/.*)?$/);
    if (!m) return texto(res, headers, 404, 'não encontrado');
    const slug = m[1];
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    let resto = m[2];
    if (!resto) {
      if (!req.url.split('?')[0].endsWith('/')) { res.writeHead(302, { ...headers, Location: '/p/' + slug + '/' + q }); return res.end(); }
      resto = '/';
    }
    try {
      const r = await pedir({ slug, caminho: resto + q, metodo: req.method, accept: String(req.headers.accept || '*/*').slice(0, 200) });
      const saida = { ...headers, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
      for (const k of HEADERS_OK) if (r.headers && typeof r.headers[k] === 'string') saida[k] = r.headers[k].slice(0, 500);
      const status = Number(r.status) >= 200 && Number(r.status) < 600 ? Number(r.status) : 502;
      res.writeHead(status, saida);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(String(r.corpo || ''), 'base64'));
    } catch (e) {
      const c = e.codigo || 502;
      const msg = c === 503 ? 'A Fábrica está offline no momento.' : c === 429 ? 'Muitos pedidos ao mesmo tempo.' : c === 504 ? 'A Fábrica demorou a responder.' : 'Falha ao buscar a página.';
      texto(res, headers, c, msg);
    }
  }

  return { instalar, atender, estado, online };
}
