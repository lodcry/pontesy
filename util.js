// Utilidades puras: sanitização, resposta JSON, leitura de corpo.
const MAX_BODY_BYTES = 1024 * 1024;

export function sanitizar(valor) {
  return String(valor ?? '')
    .replace(/\u0000/g, '')
    .replace(/(bearer\s+)[^\s"'`]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s"'`]+/gi, '$1[REDACTED]')
    .slice(0, 20000);
}

export function responderJson(res, dados, status = 200, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(dados));
}

export function jsonRpcErro(id, codigo, mensagem, dados) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: codigo, message: mensagem, ...(dados === undefined ? {} : { data: dados }) },
  };
}

export function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    let excedeu = false;
    req.on('data', parte => {
      if (excedeu) return;
      const bloco = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
      tamanho += bloco.length;
      if (tamanho > MAX_BODY_BYTES) {
        excedeu = true;
        partes.length = 0;
        reject(new Error('Corpo da requisição excede o limite permitido.'));
        req.destroy();
        return;
      }
      partes.push(bloco);
    });
    req.on('end', () => {
      if (excedeu) return;
      const corpo = Buffer.concat(partes).toString('utf8');
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch {
        reject(new Error('O corpo da requisição não contém JSON válido.'));
      }
    });
    req.on('error', reject);
  });
}