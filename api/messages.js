const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function querySupabase(table) {
  return new Promise((resolve, reject) => {
    const urlStr = `${SUPABASE_URL}/rest/v1/${table}?limit=20`;
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

function detectTable(message) {
  const msg = message.toLowerCase();
  if (msg.includes('estudiante') || msg.includes('alumno')) return 'estudiantes';
  if (msg.includes('docente') || msg.includes('profesor')) return 'docentes';
  if (msg.includes('cohorte') || msg.includes('periodo')) return 'cohortes';
  if (msg.includes('asignatura') || msg.includes('materia')) return 'asignaturas';
  if (msg.includes('asistencia')) return 'asistencia';
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = req.headers['x-api-key'];
  let body = req.body;

  const messages = body.messages || [];
  const lastMsg = messages.filter(m => m.role === 'user').slice(-1)[0];

  if (lastMsg && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const table = detectTable(lastMsg.content);
    if (table) {
      const data = await querySupabase(table);
      body = {
        ...body,
        system: body.system + `\n\nDATA REAL DE SUPABASE (tabla: ${table}):\n${JSON.stringify(data, null, 2)}\n\nUsa estos datos para responder.`
      };
    }
  }

  const bodyStr = JSON.stringify(body);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  };

  return new Promise((resolve) => {
    const proxyReq = https.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.status(proxyRes.statusCode).json(JSON.parse(data));
        resolve();
      });
    });
    proxyReq.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });
    proxyReq.write(bodyStr);
    proxyReq.end();
  });
};
