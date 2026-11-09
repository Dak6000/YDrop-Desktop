// Analyse des liens YouTube (watch, youtu.be, shorts, live, embed, playlist, m., music.)
const ID = /^[\w-]{11}$/;
const URL_RE = /https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s"'<>]*/gi;

function parseYouTube(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const list = u.searchParams.get('list');
  const listId = list && !/^RD/i.test(list) ? list : null; // RD… = « mix » infini : ignoré
  let id = null;

  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'live', 'embed', 'v'].includes(seg[0])) id = seg[1];
    else if (seg[0] === 'playlist' && listId) {
      return { kind: 'playlist', id: null, listId, url: 'https://www.youtube.com/playlist?list=' + listId };
    }
  } else return null;

  if (!id || !ID.test(id)) return null;
  return { kind: 'video', id, listId, url: 'https://www.youtube.com/watch?v=' + id };
}

function extractUrls(text) {
  const found = (String(text || '').match(URL_RE) || []).map(s => s.replace(/[)\].,;:!?]+$/, ''));
  const seen = new Set(); const out = [];
  for (const raw of found) {
    const p = parseYouTube(raw);
    if (!p) continue;
    const key = p.kind === 'video' ? 'v:' + p.id : 'l:' + p.listId;
    if (seen.has(key)) continue;
    seen.add(key); out.push(p);
  }
  return out;
}

module.exports = { parseYouTube, extractUrls };
