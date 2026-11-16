// Sobe o servidor, conecta uma "Fábrica" falsa por WebSocket e confere o caminho completo.
// Uso: npm test (dentro de pontesyfabrica/)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORTA = 39517, TOKEN = 'token-de-teste', BASE = `http://127.0.0.1:${PORTA}`;
let falhas = 0;
const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) falhas++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));

const filho = spawn(process.execPath, ['server.js'], {
  cwd: DIR, env: { ...process.env, PORT: String(PORTA), SYNAPSE_TOKEN: TOKEN, HOST: '127.0.0.1' }, stdio: 'ignore',
});

async function mcp(caminho, corpo, comToken = true) {
  const r = await fetch(BASE + caminho, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(comToken ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: JSON.stringify(corpo),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const chamada = acao => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'synapse', arguments: { acao } } });

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/saude')).ok) break; } catch {} await dormir(100); }

  const saude = await (await fetch(BASE + '/saude')).json();
  ok(saude.status === 'ok' && saude.fabrica.online === false, '/saude responde e Fábrica começa offline');
  ok((await mcp('/mcp', chamada('entrar'), false)).status === 401, 'POST sem token dá 401');
  const off = await mcp('/mcp', chamada('entrar'));
  ok(off.json?.result?.isError === true && /offline/i.test(off.json.result.content[0].text), 'tools/call offline avisa que a Fábrica está offline');
  const lista = await mcp('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  ok(lista.json?.result?.tools?.[0]?.name === 'synapse', 'tools/list funciona offline (modelo reserva)');

  const ws = new WebSocket(`ws://127.0.0.1:${PORTA}/ponte`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.tipo === 'listar') ws.send(JSON.stringify({ id: m.id, resultado: [{ name: 'synapse', description: 'real', inputSchema: { type: 'object' } }] }));
    else if (m.tipo === 'instrucoes') ws.send(JSON.stringify({ id: m.id, resultado: 'missão de ' + m.agente }));
    else ws.send(JSON.stringify({ id: m.id, resultado: `eco:${m.args.acao}:${m.args.agente || ''}` }));
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await dormir(200);

  ok((await (await fetch(BASE + '/saude')).json()).fabrica.online === true, '/saude mostra a Fábrica online');
  const viva = await mcp('/a/mcp1/t/' + TOKEN + '/mcp', chamada('entrar'), false);
  ok(viva.json?.result?.content?.[0]?.text === 'eco:entrar:mcp1', 'tools/call chega ao Termux com o agente da URL');
  const real = await mcp('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  ok(real.json?.result?.tools?.[0]?.description === 'real', 'tools/list vem da Fábrica real');
  const ini = await mcp('/a/mcp2/mcp', { jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  ok(ini.json?.result?.instructions === 'missão de mcp2', 'initialize traz a missão do agente');

  const badWs = new WebSocket(`ws://127.0.0.1:${PORTA}/ponte`, { headers: { Authorization: 'Bearer errado' } });
  const recusado = await new Promise(res => { badWs.on('error', () => res(true)); badWs.on('open', () => res(false)); });
  ok(recusado, 'WebSocket com token errado é recusado');
  ws.close();
} catch (e) {
  ok(false, 'teste abortou: ' + e.message);
} finally {
  filho.kill();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nPONTE OK');
process.exit(falhas ? 1 : 0);