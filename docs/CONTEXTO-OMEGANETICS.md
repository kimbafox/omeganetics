# 🌐 Omeganetics — Contexto, visión y plan (documento maestro)

> Documento de contexto para trabajar en otros chats (incluida la sincronización con **Meta Ads** y **TikTok Ads** para campañas del servidor). Resume qué es Omeganetics, qué está construido, la visión y los ángulos de marketing. **No contiene credenciales.**
> Última actualización: 2026-06-03.

---

## 1. Resumen ejecutivo
**Omeganetics** es una **comunidad gamer competitiva de Latinoamérica** centrada en un servidor de **Discord** (~551 miembros) potenciado por una **plataforma web propia** (omeganetics.com). La identidad es **"imperio gamer"**: estética imperial/competitiva, con un sistema de **rangos, niveles, logros y una moneda virtual (Omegacoin)** que premia la actividad real de los miembros.

La meta inmediata: **reactivar a la comunidad y generar actividad**; luego, **crecer con publicidad** (Meta/TikTok) y monetizar (moneda, tienda, eventos, creadores).

- 🌐 Web: **https://omeganetics.com**
- 💬 Discord: **https://discord.gg/bCWjyns8U5**
- 👑 Admins: Kimba y Sebastián (Sebillas)

---

## 2. Visión
Construir la **comunidad gamer de LATAM más activa y mejor organizada**, donde la gente:
- Conozca jugadores y juegue **en conjunto** (no en solitario).
- Participe en **eventos y torneos** de distintos juegos.
- Suba de **nivel y rango** por su actividad, gane **Omegacoins** y **logros**.
- Apoye y descubra **creadores de contenido** de la comunidad.
- Disfrute una comunidad **controlada, sana y competitiva**.

---

## 3. Identidad de marca
- **Nombre:** Omeganetics ("imperio gamer de Latinoamérica").
- **Tono:** competitivo, épico/imperial, gamer, cercano y con humor. Edgy-divertido.
- **Tema visual:** oscuro con acentos **blurple (Discord)**, tipografía moderna (Inter). Cada sección tiene color característico: **Wiki = verde**, **Realm/Tienda = guindo**, **Discord = blurple**.
- **Lema/gancho:** *"¿Listo para ascender de Recluta a Ascendido? Únete, juega y conquista."*
- **Escalera de rangos:** Recluta → Conquistadores → Exterminadores → Eruditos → Inquisidoras → Ascendidos.
- **Moneda:** **Omegacoin** 🪙.

---

## 4. La comunidad (Discord)
- **~551 miembros (~96 en línea).** Servidor tipo **Comunidad** con Onboarding, AutoMod, Soundboard, Server Guide y News activos.
- Mayoría hoy **poco activa (AFK)** → objetivo: reactivar.
- **Estructura:** categorías Palacio Imperial (anuncios), Campo General (chat, tickets, reportes), Entretenimiento (memes, arte, contenido), Sala de Voz (campos de batalla, eventos, AFK).
- **Juegos populares en el server:** Minecraft, Valorant, Roblox, Counter-Strike 2, Dota 2, Overwatch, FFXIV, entre otros.
- **Proyectos propios:** Omegacraft (Minecraft), Steel Ball Craft, Culling Game, Erudito, Cofu.
- Economía de Omegacoins **ya existente** (bot OMEGACOINS-BANK) → se integrará con la plataforma.

---

## 5. La plataforma web (omeganetics.com) — qué está EN VIVO
La web es una app **Express + PostgreSQL desplegada en Railway**, con:

- **Login con Discord** (solo miembros del servidor) → cada usuario tiene perfil.
- **Perfil personal** (`/perfil.html`): avatar, rango/rol, nivel + barra de XP, actividad y logros.
- **Actividad del servidor** (`/actividad.html`):
  - 🎮 *Jugándose ahora* (en vivo, vía presencia de Discord).
  - 📈 *Juegos más jugados* (acumulado semana/mes con %).
  - 🏆 *Jugadores más activos* (ranking por puntos de **voz + mensajes**).
- **Niveles y XP**: XP = tiempo en voz (×5) + mensajes (×1). El juego se mide pero **no puntúa**.
- **Logros/insignias** (`/perfil.html`): automáticos (mensajes, horas en voz, nivel, eventos) y manuales (Campeón, Streamer aliado, Fundador, MVP). Con **rareza y brillo** (común/raro/épico/legendario).
- **Eventos** (`/eventos.html`): cualquier miembro crea un evento (formulario) → admins aprueban → se **anuncia en Discord con @everyone**.
- **Creadores de contenido** (`/creadores.html`): postulación → aprobación admin → panel para **subir videos**, que se publican en el canal CONTENIDO + aviso en general (con @everyone).
- **Bienvenida automática** a nuevos miembros con invitación a la web.
- Secciones heredadas: **Wiki** (lore), **Realm/Tiendita** (tienda), panel de equipo (¿Quiénes somos?).

> Tracking: el bot mide en tiempo real **voz, mensajes y juegos** por usuario (ignora el canal AFK) y alimenta niveles, ranking y logros.

---

## 6. Plan / Roadmap

### ✅ Hecho y en vivo
Login Discord · perfiles · tracking (voz/mensajes/juegos) · niveles/XP · logros con rareza · actividad (en vivo + histórico + ranking) · eventos (crear/aprobar/anunciar) · creadores (postular/aprobar/subir + anuncios) · bienvenida · diseño unificado + móvil · limpieza del servidor (10 bots redundantes fuera).

### 🔜 Aprobado, por construir
- **Leaderboard en un canal de Discord** (mensaje auto-actualizado).
- **Logros → roles de Discord** (usar la escalera de rangos).
- **Economía Omegacoin** (integrar con el banco existente):
  - Subir de nivel: **100** coins + **10 por nivel**.
  - Logros: común **100** / raro **300** / épico **1000** / legendario **5000**.
  - Top semanal del leaderboard: **1000** coins.
  - Recompensas individuales ≤ ~10k. Coins para **tienda** (cosméticos, roles con privilegios).
- **Programa de referidos**: quien invita gana **10% extra** (bono) de los coins de su referido.
- **Tienda de canjes** (cosméticos/utilidades/roles).
- **Alianzas** con otros servers/streamers (canal, anuncios cruzados, rol "Aliado", eventos colaborativos).
- **Campaña de reactivación**: bienvenida mejorada + DM con goteo (1-5/día) + @everyone.

---

## 7. Propuesta de valor / diferenciadores (para ads)
Lo que **nos hace únicos** frente a otros servers de Discord:
1. **Plataforma web propia** ligada al Discord (no solo un server más).
2. **Sistema de niveles, XP y rangos** que premia la actividad real (voz + chat).
3. **Logros/insignias** coleccionables con rareza y brillo.
4. **Moneda Omegacoin** que se gana jugando y se canjea.
5. **Eventos y torneos** con anuncios automáticos.
6. **Programa de creadores**: publicita tu canal en la comunidad.
7. Comunidad **LATAM en español**, competitiva y organizada.

---

## 8. Público objetivo (targeting para Meta/TikTok Ads)
- **Geografía:** Latinoamérica (México, Colombia, Argentina, Perú, Chile, Bolivia, etc.) — español.
- **Edad:** ~13–25 (núcleo gamer joven). *(Ajustar según política de la plataforma; Discord requiere 13+.)*
- **Intereses:** Discord, Minecraft, Valorant, Roblox, Counter-Strike, esports, comunidades gamer, streamers (Twitch/Kick/YouTube/TikTok Gaming).
- **Dispositivos:** móvil (TikTok) + escritorio (Discord).
- **Perfiles:** jugadores que buscan **comunidad/amigos para jugar**, competir en torneos, o **creadores** que buscan audiencia.

---

## 9. Ángulos / mensajes publicitarios sugeridos
- *"Únete al imperio gamer de LATAM 👑 — sube de nivel, gana Omegacoins y juega con la comunidad."*
- *"¿Juegas solo? Encuentra tu escuadra. Eventos, torneos y premios cada semana."*
- *"Crea contenido y haz que toda la comunidad vea tus videos."* (para creadores)
- *"De Recluta a Ascendido: tu actividad te sube de rango."*
- CTAs: **"Únete al Discord"** / **"Entra a omeganetics.com"**.
- Formatos TikTok: clips de gameplays de la comunidad, momentos de eventos/torneos, "antes/después" de rango, testimonios de miembros.

---

## 10. Activos de marketing
- **Etiquetas (DISBOARD/listados):** Comunidad · Gaming · Español · Latino · Eventos (rotar con Minecraft/Valorant/Memes/Torneos).
- **Descripción corta:** *"⚔️ Omeganetics — La comunidad gamer de LATAM. Eventos, torneos, niveles y recompensas. ¡Únete al Imperio! 👑"*
- **Links:** web `https://omeganetics.com` · Discord `https://discord.gg/bCWjyns8U5`
- **Recursos visuales:** logo, ilustraciones de soldados/imperial (en la web), 202 emojis del servidor.

---

## 11. Datos técnicos (referencia)
- **Repo:** `kimbafox/omeganetics` (GitHub) · **Hosting:** Railway (web + PostgreSQL) · **Stack:** Node/Express + Postgres + bot discord.js integrado.
- **Dominio:** omeganetics.com.

---

## 12. Estado actual y próximos pasos
- **Ahora:** terminando limpieza del servidor y pasando a **mejoras de la web** + arranque de la lista aprobada (leaderboard, logros→roles, Omegacoin).
- **Después:** campañas de publicidad (Meta/TikTok) para crecer, una vez la comunidad esté activa y la plataforma pulida.
