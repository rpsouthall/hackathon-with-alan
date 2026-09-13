const API = 'https://api.liveavatar.com/v1';
const required = ['LIVEAVATAR_API_KEY', 'LIVEAVATAR_AVATAR_ID', 'LIVEAVATAR_ELEVENLABS_SECRET_ID', 'ELEVENLABS_AGENT_ID', 'DEMO_ACCESS_CODE'];

// Standard Fetch handler: mount in the Sites starter's server route adapter.
// No Node APIs, local filesystem, or in-memory session ownership required.
export function createHandler(env, fetchImpl = fetch) {
  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGIN || url.origin;
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'vary': 'Origin' };
    if (origin === allowed) Object.assign(headers, {
      'access-control-allow-origin': allowed,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Demo-Access-Code',
    });
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && origin !== allowed) return reply(403, { error: 'origin_not_allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return reply(200, { status: 'ok', configured: required.every(k => Boolean(env[k])), sourceLanguage: 'ja', targetLanguage: 'en' });
    }
    if (!['/api/sessions', '/api/sessions/stop'].includes(url.pathname)) return reply(404, { error: 'not_found' });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    if (!required.every(k => Boolean(env[k]))) return reply(503, { error: 'voice_not_configured' });
    if (request.headers.get('x-demo-access-code') !== env.DEMO_ACCESS_CODE) return reply(401, { error: 'access_code_required' });

    async function provider(path, authorization, body) {
      const result = await fetchImpl(`${API}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...authorization },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(25000),
      });
      if (!result.ok) throw new Error('provider_request_failed');
      const data = await result.json();
      return data.data;
    }
    let token;
    try {
      if (url.pathname === '/api/sessions/stop') {
        const bearer = request.headers.get('authorization');
        if (!bearer?.startsWith('Bearer ') || bearer.length > 8192) return reply(400, { error: 'session_token_required' });
        await provider('/sessions/stop', { Authorization: bearer }, { reason: 'USER_CLOSED' });
        return reply(200, { stopped: true });
      }
      const config = {
        secret_id: env.LIVEAVATAR_ELEVENLABS_SECRET_ID,
        agent_id: env.ELEVENLABS_AGENT_ID,
        ...(env.ELEVENLABS_VOICE_ID ? { voice_id: env.ELEVENLABS_VOICE_ID } : {}),
      };
      const minted = await provider('/sessions/token', { 'X-API-KEY': env.LIVEAVATAR_API_KEY }, {
        mode: 'LITE', avatar_id: env.LIVEAVATAR_AVATAR_ID,
        max_session_duration: 300, elevenlabs_agent_config: config,
      });
      token = minted?.session_token;
      if (!token) throw new Error('missing_token');
      const started = await provider('/sessions/start', { Authorization: `Bearer ${token}` });
      if (!started?.session_id || !started.livekit_url || !started.livekit_client_token) throw new Error('invalid_session');
      // Explicit allowlist: never return the provider's agent token or API credentials.
      return reply(201, {
        sessionId: started.session_id, roomId: started.session_id,
        sessionToken: token, livekitUrl: started.livekit_url,
        livekitClientToken: started.livekit_client_token,
        sourceLanguage: 'ja', targetLanguage: 'en',
      });
    } catch {
      if (token) {
        try { await provider('/sessions/stop', { Authorization: `Bearer ${token}` }, { reason: 'USER_CLOSED' }); } catch { /* Provider duration cap bounds orphan sessions. */ }
      }
      return reply(502, { error: 'voice_provider_failed', message: 'Could not complete the voice session request. Check provider configuration and credits.' });
    }
  };
}
