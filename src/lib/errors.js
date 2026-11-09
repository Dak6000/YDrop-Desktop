// Transforme la sortie brute de yt-dlp en message compréhensible + action proposée
// action : 'update-ytdlp' | 'cookies' | 'install-deno' | 'retry' | null
const RULES = [
  { code: 'bin-missing', re: /ENOENT|spawn .* ENOENT|not recognized as an internal/i,
    title: 'yt-dlp est introuvable',
    hint: 'Le fichier bin/yt-dlp est absent. Vérifiez l\'état des outils dans Paramètres › Outils.', action: null },
  { code: 'disk', re: /No space left|ENOSPC|disk full/i,
    title: 'Disque plein', hint: 'Libérez de l\'espace sur le disque ou choisissez un autre dossier de sortie.', action: null },
  { code: 'permission', re: /EACCES|EPERM|Permission denied|Access is denied/i,
    title: 'Accès refusé au dossier', hint: 'Choisissez un dossier de sortie où vous avez le droit d\'écrire (ex. Téléchargements).', action: null },
  { code: 'cookies-read', re: /Could not copy .*cookie|cookie database|Failed to decrypt|DPAPI|could not find .* cookies|cookies? .*(locked|in use)/i,
    title: 'Impossible de lire les cookies du navigateur',
    hint: 'Fermez complètement le navigateur choisi (Chrome/Edge verrouillent leurs cookies) ou choisissez Firefox dans Paramètres › Téléchargement.', action: null },
  { code: 'bot-check', re: /Sign in to confirm you.?re not a bot|confirm you.?re not a bot|cookies-from-browser/i,
    title: 'YouTube demande de prouver que vous n\'êtes pas un robot',
    hint: 'Dans Paramètres › Téléchargement, choisissez le navigateur où vous êtes connecté à YouTube (cookies), puis réessayez.', action: 'cookies' },
  { code: 'age', re: /age-restricted|Sign in to confirm your age|inappropriate for some users/i,
    title: 'Vidéo avec restriction d\'âge',
    hint: 'Connectez-vous à YouTube dans votre navigateur, puis activez « Utiliser les cookies du navigateur » dans les Paramètres.', action: 'cookies' },
  { code: 'private', re: /Private video|This video is private/i,
    title: 'Vidéo privée', hint: 'Seul son propriétaire peut la voir. Si elle est à vous, activez les cookies du navigateur dans les Paramètres.', action: 'cookies' },
  { code: 'members', re: /members-only|Join this channel|available to this channel's members/i,
    title: 'Vidéo réservée aux membres', hint: 'Il faut être membre de la chaîne : activez les cookies du navigateur (compte membre) dans les Paramètres.', action: 'cookies' },
  { code: 'geo', re: /not available in your country|blocked it in your country|geo.?restrict/i,
    title: 'Vidéo bloquée dans votre pays', hint: 'Le propriétaire a restreint cette vidéo géographiquement.', action: null },
  { code: 'live', re: /Premieres in|live event will begin|This live event|is live\b.*not supported/i,
    title: 'Direct ou première pas encore terminé', hint: 'Réessayez quand la diffusion sera terminée.', action: null },
  { code: 'unavailable', re: /Video unavailable|has been removed|no longer available|account associated with this video has been terminated|This video is not available|This video has been removed/i,
    title: 'Vidéo indisponible ou supprimée', hint: 'Vérifiez le lien : la vidéo n\'existe plus ou n\'est plus accessible.', action: null },
  { code: 'js-runtime', re: /No supported JavaScript runtime|JavaScript runtime|n challenge solving failed|Only images are available|nsig extraction failed/i,
    title: 'Composant JavaScript manquant (Deno)',
    hint: 'Depuis fin 2025, YouTube nécessite un runtime JavaScript pour yt-dlp. YDrop peut l\'installer automatiquement.', action: 'install-deno' },
  { code: 'rate-limit', re: /HTTP Error 429|Too Many Requests/i,
    title: 'Trop de requêtes (limite YouTube)', hint: 'Attendez quelques minutes, ou utilisez les cookies du navigateur dans les Paramètres.', action: 'retry', retryable: true },
  { code: 'http403', re: /HTTP Error 403|Forbidden/i,
    title: 'Accès refusé par YouTube (403)', hint: 'Cause la plus fréquente : yt-dlp est périmé. YDrop va le mettre à jour.', action: 'update-ytdlp', retryable: true },
  { code: 'outdated', re: /Signature extraction failed|Unable to extract|Failed to extract|player response|HTTP Error 400|Requested format is not available|Some formats may be missing|nsig|ExtractorError/i,
    title: 'YouTube a changé : yt-dlp doit être mis à jour', hint: 'Une mise à jour de yt-dlp corrige généralement ce problème.', action: 'update-ytdlp', retryable: true },
  { code: 'network', re: /Unable to download webpage|getaddrinfo|Temporary failure in name resolution|Network is unreachable|timed out|Connection reset|Connection aborted|SSL:|ETIMEDOUT|ECONNRESET|ENOTFOUND|Read timed out|IncompleteRead|Remote end closed/i,
    title: 'Problème de connexion internet', hint: 'Vérifiez votre connexion. YDrop réessaie automatiquement quelques fois.', action: 'retry', retryable: true },
  { code: 'ffmpeg', re: /ffmpeg|ffprobe|Postprocessing|Conversion failed/i,
    title: 'Erreur ffmpeg pendant la conversion', hint: 'Vérifiez que ffmpeg est bien présent (Paramètres › Outils).', action: null },
  { code: 'url', re: /Unsupported URL|is not a valid URL/i,
    title: 'Lien non reconnu', hint: 'Collez un lien YouTube complet (vidéo, short ou playlist).', action: null },
];

function lastErrorLine(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find(l => /^ERROR:/i.test(l));
  return (err || lines[lines.length - 1] || '').replace(/^ERROR:\s*/i, '').slice(0, 300);
}

function classify(stderr, fallbackMessage) {
  const all = [stderr, fallbackMessage].filter(Boolean).join('\n');
  // On teste d'abord les lignes « ERROR: » (les plus fiables), puis tout le texte
  const errLines = all.split(/\r?\n/).filter(l => /^\s*ERROR:/i.test(l)).join('\n');
  for (const text of [errLines, all]) {
    if (!text) continue;
    for (const r of RULES) {
      if (r.re.test(text)) {
        return { code: r.code, title: r.title, hint: r.hint, action: r.action, retryable: !!r.retryable, detail: lastErrorLine(all) };
      }
    }
  }
  const text = all;
  return {
    code: 'unknown', title: 'Le téléchargement a échoué',
    hint: 'Raison inconnue. Essayez de mettre à jour yt-dlp, puis réessayez. Les détails techniques peuvent aider à comprendre.',
    action: 'update-ytdlp', retryable: false, detail: lastErrorLine(text),
  };
}

module.exports = { classify, lastErrorLine };
