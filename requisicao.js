// Mesmo comportamento do Synapse real: /a/<agente>, /t/<token>, ?token= e barra final.
// Token na URL pode aparecer em logs; prefira Bearer quando o cliente permitir.
export function normalizar(req) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;
  const mAg = pathname.match(/^\/a\/([\w-]{1,30})(\/.*)?$/);
  if (mAg) { req.headers['x-agente'] = mAg[1]; pathname = mAg[2] || '/'; }
  const mTok = pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (mTok) {
    if (!req.headers.authorization) req.headers.authorization = 'Bearer ' + decodeURIComponent(mTok[1]).trim();
    pathname = mTok[2] || '/';
  }
  const qTok = url.searchParams.get('token');
  if (qTok && !req.headers.authorization) req.headers.authorization = 'Bearer ' + qTok.trim();
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  return { url, pathname };
}