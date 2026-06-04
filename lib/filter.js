// Filtro de contenido para textos que el bot publicará/usará automáticamente
// (shoutouts, nombres de canal). Bloquea SLURS de odio y contenido obsceno/ilegal,
// pero PERMITE insultos simples y temática de videojuegos (muerte, kill, matar, etc.).
//
// La lista es fácil de ajustar: agrega/quita términos en BANNED.

const BANNED = [
  // Slurs de odio (racial/lgbt) — bloqueados
  "nigger", "nigga", "niggers", "niglet", "negrata",
  "spic", "chink", "wetback", "beaner", "kike", "paki",
  "faggot", "fag", "tranny", "retard", "retarded",
  // Sexual explícito / ilegal — bloqueado
  "porn", "porno", "pornography", "xxx", "hentai",
  "rape", "rapist", "violacion", "violador", "violar",
  "pedofilo", "pedophile", "pedofilia", "zoofilia", "bestialidad", "incesto",
  "child porn", "childporn",
];

// quita acentos, pasa a minúsculas, deshace leetspeak básico
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// true si el texto contiene contenido prohibido
function hasBannedContent(text) {
  const norm = normalize(text);
  if (!norm) return false;
  const tokens = new Set(norm.split(" "));
  for (const w of BANNED) {
    if (w.includes(" ")) {
      if (norm.includes(w)) return true; // frase
    } else if (tokens.has(w)) {
      return true; // palabra exacta (evita falsos positivos por substrings)
    }
  }
  return false;
}

module.exports = { hasBannedContent };
