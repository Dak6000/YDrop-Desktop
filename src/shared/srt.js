// Outils SRT — utilisables dans le processus principal (require) ET dans l'interface (window.YSrt)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSrt = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function toSec(h, m, s, ms) { return (+h) * 3600 + (+m) * 60 + (+s) + (+String(ms).padEnd(3, '0').slice(0, 3)) / 1000; }

  function parse(text) {
    const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const cues = [];
    const re = /(?:^|\n)(?:\d+\n)?(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\n|\n*$)/g;
    let m;
    while ((m = re.exec(src))) {
      const body = m[9].replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').split('\n').map(l => l.trim()).filter(Boolean);
      if (!body.length) continue;
      cues.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), lines: body });
    }
    return cues.map(c => ({ start: c.start, end: c.end, text: c.lines.join('\n') }));
  }

  function pad(n, w) { return String(n).padStart(w, '0'); }
  function ts(sec) {
    sec = Math.max(0, sec);
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
  }
  function stringify(cues) {
    return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
  }

  // Les sous-titres automatiques YouTube « défilent » : chaque cue répète la ligne précédente.
  // On ne garde que les lignes nouvelles pour obtenir un texte lisible sans doublons.
  function cleanAuto(cues) {
    const out = [];
    let prev = new Set();
    for (const c of cues) {
      const lines = c.text.split('\n').map(l => l.trim()).filter(Boolean);
      const fresh = lines.filter(l => !prev.has(l));
      prev = new Set(lines);
      if (!fresh.length) continue;
      const last = out[out.length - 1];
      if (last && last.text === fresh.join('\n')) { last.end = Math.max(last.end, c.end); continue; }
      out.push({ start: c.start, end: c.end, text: fresh.join('\n') });
    }
    // Évite les chevauchements : une cue se termine au plus tard quand la suivante commence
    for (let i = 0; i < out.length - 1; i++) if (out[i].end > out[i + 1].start) out[i].end = out[i + 1].start;
    return out.filter(c => c.end - c.start > 0.05);
  }

  // Extrait [start,end] et recale à 0 (pour un segment découpé)
  function slice(cues, start, end) {
    const out = [];
    for (const c of cues) {
      if (c.end <= start || c.start >= end) continue;
      out.push({ start: Math.max(c.start, start) - start, end: Math.min(c.end, end) - start, text: c.text });
    }
    return out;
  }

  // Style « TikTok » : coupe en petits groupes de mots (maxWords), durée répartie selon la longueur
  function rechunk(cues, maxWords) {
    if (!maxWords || maxWords < 1) return cues;
    const out = [];
    for (const c of cues) {
      const words = c.text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
      if (words.length <= maxWords) { out.push({ start: c.start, end: c.end, text: words.join(' ') }); continue; }
      const n = Math.ceil(words.length / maxWords), size = Math.ceil(words.length / n);
      const groups = [];
      for (let i = 0; i < words.length; i += size) groups.push(words.slice(i, i + size).join(' '));
      const total = groups.reduce((a, g) => a + g.length, 0) || 1;
      let t = c.start; const dur = c.end - c.start;
      groups.forEach((g, i) => {
        const d = i === groups.length - 1 ? c.end - t : dur * (g.length / total);
        out.push({ start: t, end: t + d, text: g });
        t += d;
      });
    }
    return out;
  }

  function activeAt(cues, t) {
    for (const c of cues) if (t >= c.start && t < c.end) return c;
    return null;
  }

  return { parse, stringify, cleanAuto, slice, rechunk, activeAt, ts };
});
