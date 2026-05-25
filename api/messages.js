const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Query Supabase REST API
function querySupabase(table, params = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}${params}`);
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
    req.on('error', reject);
    req.end();
  });
}

// Detect if message needs Supabase data
function detectSupabaseIntent(message) {
  const msg = message.toLowerCase();
  const intents = {
    estudiantes: ['estudiante', 'estudiantes', 'alumno', 'alumnos', 'matriculado', 'matriculados'],
    docentes: ['docente', 'docentes', 'profesor', 'profesores'],
    cohortes: ['cohorte', 'cohortes', 'grupo', 'periodo'],
    asignaturas: ['asignatura', 'asignaturas', 'materia', 'materias', 'curso'],
    asistencia: ['asistencia', 'asistió', 'faltó', 'presente'],
  };
  for (const [table, keywords] of Object.entries(intents)) {
    if (keywords.some(k => msg.includes(k))) return table;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = req.headers['x-api-key'];
  let body = req.body;

  // Detect Supabase intent from last user message
  const messages = body.messages || [];
  const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
  
  if (lastUserMsg && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const table = detectSupabaseIntent(lastUserMsg.content);
    if (table) {
      try {
        const data = await querySupabase(table, '?limit=20');
        const dataStr = JSON.stringify(data, null, 2);
        // Inject data into system prompt
        body = {
          ...body,
          system: body.system + `\n\nDATA DE SUPABASE (tabla: ${table}):\n${dataStr}\n\nUsa estos datos reales para responder la pregunta del usuario.`
        };
      } catch (e) {
        console.error('Supabase error:', e.message);
      }
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
}
