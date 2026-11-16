// Teste do túnel: sobe o server.js local, finge ser o Termux e confere o caminho completo.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORTA = 3900 + Math.floor(Math.random() * 90);
const filho = spawn(process.execPath, ['server.js'], {
  cwd: dir, stdio: 'ignore',
  env: { ...process.env, SYNAPSE_TOKEN: 'segredo-de-teste', PORT: String(PORTA), HOST: '127.0.0.1' },
});
const base = 'http://127.0.0.1:' + PORTA;
const esperar = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
const t = (nome, cond) => { assert.ok(cond, 'FALHOU: ' + nome); n++; console.log('ok - ' + nome); };

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/saude'); if (r.ok) break; } catch {} await esperar(200); }
  let r = await fetch(base + '/p/demo/');
  t('offline devolve 503', r.status === 503);
  const ruim = new WebSocket('ws://127.0.0.1:' + PORTA + '/tunel', { headers: { Authorization: 'Bearer errado' } });
  t('token errado é recusado', await new Promise(res => { ruim.on('error', () => res(true)); ruim.on('open', () => res(false)); }));
  const ws = new WebSocket('ws://127.0.0.1:' + PORTA + '/tunel', { headers: { Authorization: 'Bearer segredo-de-teste' } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.tipo !== 'http') return;
    const corpo = m.slug === 'fechado' ? 'nao' : '<h1>' + m.slug + ' ' + m.caminho + '</h1>';
    ws.send(JSON.stringify({ id: m.id, resultado: {
      status: m.slug === 'fechado' ? 404 : 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'x=1' },
      corpo: Buffer.from(corpo).toString('base64'),
    } }));
  });
  await esperar(200);
  r = await fetch(base + '/p/demo/pagina?a=1');
  t('página passa pelo túnel', r.status === 200 && (await r.text()) === '<h1>demo /pagina?a=1</h1>');
  t('set-cookie não vaza', r.headers.get('set-cookie') === null);
  r = await fetch(base + '/p/demo/');
  t('raiz da doca', (await r.text()) === '<h1>demo /</h1>');
  r = await fetch(base + '/p/demo', { redirect: 'manual' });
  t('sem barra redireciona', r.status === 302 && r.headers.get('location') === '/p/demo/');
  r = await fetch(base + '/p/fechado/');
  t('doca fechada = 404', r.status === 404);
  r = await fetch(base + '/p/DEMO/');
  t('slug inválido = 404', r.status === 404);
  r = await fetch(base + '/saude');
  const s = await r.json();
  t('saúde mostra túnel online', s.tunel && s.tunel.online === true);
  console.log('TUDO CERTO: ' + n + ' verificações');
} catch (e) {
  console.error(String(e.message || e));
  process.exitCode = 1;
} finally {
  filho.kill();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
