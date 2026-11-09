// Calcul des segments (fenêtre principale ET tests) — window.YPlan
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const MIN_TAIL = 0.5; // un reste < 0,5 s est fusionné dans le segment précédent

  // Découpe fixe : segments de `target` secondes
  function fixed(start, end, target) {
    const segs = [];
    if (!(target > 0) || end <= start) return segs;
    for (let s = start; s < end - 1e-6; s += target) segs.push({ start: s, end: Math.min(s + target, end) });
    if (segs.length > 1 && segs[segs.length - 1].end - segs[segs.length - 1].start < MIN_TAIL) {
      const t = segs.pop(); segs[segs.length - 1].end = t.end;
    }
    return segs;
  }

  // Découpe « intelligente » : coupe de préférence au milieu d'une pause (silence) proche de la durée cible
  // silences : [{start,end}] en secondes
  function smart(start, end, target, silences) {
    const mids = (silences || []).map(s => (s.start + s.end) / 2).filter(m => m > start && m < end);
    const segs = [];
    let cur = start;
    while (end - cur > target * 1.2) {
      const lo = cur + target * 0.7, hi = cur + target * 1.2, want = cur + target;
      let best = null;
      for (const m of mids) if (m >= lo && m <= hi && (best === null || Math.abs(m - want) < Math.abs(best - want))) best = m;
      const cut = best === null ? want : best;
      segs.push({ start: cur, end: cut });
      cur = cut;
    }
    if (end - cur > 1e-6) {
      const tail = end - cur;
      const prev = segs[segs.length - 1];
      if (prev && (tail < MIN_TAIL || (tail < target * 0.3 && prev.end - prev.start + tail <= target * 1.5))) prev.end = end;
      else segs.push({ start: cur, end });
    }
    return segs;
  }

  function plan({ start, end, target, smartCut, silences }) {
    const raw = smartCut && silences && silences.length ? smart(start, end, target, silences) : fixed(start, end, target);
    return raw.map((s, i) => ({ index: i + 1, start: s.start, end: s.end }));
  }

  return { plan, fixed, smart };
});
