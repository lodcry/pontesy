// Segurança de borda: CORS, hosts, token e limite de tentativas falhas.
import { timingSafeEqual } from 'node:crypto';

const TOKEN = process.env.SYNAPSE_TOKEN || '';
const JANELA_MS = 10 * 60 * 1000;
const MAX_FALHAS = 30;
const falhas = new Map();

export function corsHeaders(req) {
  const origin = req.headers.origin;
  const permitidas = (process.env.ORIGENS_PERMITIDAS || '').split(',').map(x => x.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, last-event-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version, WWW-Authenticate',
    Vary: 'Origin',
  };
  if (!origin) return headers;
  const aceita = permitidas.includes('*') || permitidas.includes(origin);
  if (aceita) headers['Access-Control-Allow-Origin'] = permitidas.includes('*') ? '*' : origin;
  return headers;
}

export function hostPermitido(req) {
  const configurados = (process.env.HOSTS_PERMITIDOS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!configurados.length || configurados.includes('*')) return true;
  const host = String(req.headers.host || '').toLowerCase();
  return configurados.includes(host) || configurados.includes(host.replace(/:\d+$/, ''));
}

export function tokenConfigurado() {
  return !!TOKEN;
}

export function tokenValido(valor) {
  if (!TOKEN) return false;
  const dado = Buffer.from(String(valor || ''));
  const esperado = Buffer.from(TOKEN);
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

export function autenticadoHttp(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return false;
  return tokenValido(authorization.slice(7).trim());
}

export function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
}

export function registrarFalha(req) {
  const ip = ipDe(req), agora = Date.now(), f = falhas.get(ip);
  if (!f || agora - f.inicio > JANELA_MS) falhas.set(ip, { n: 1, inicio: agora });
  else f.n++;
  if (falhas.size > 5000) falhas.clear();
}

export function excedeuFalhas(req) {
  const f = falhas.get(ipDe(req));
  return !!f && f.n > MAX_FALHAS && Date.now() - f.inicio <= JANELA_MS;
}