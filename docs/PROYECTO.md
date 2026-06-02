# Omeganetics Corp — Plataforma de Comunidad Gamer LATAM

> Documento vivo de ideas, propuestas y roadmap.
> Última actualización: 2026-06-02

## 1. Visión general

Convertir nuestro sitio web actual en una **mini-plataforma** conectada a nuestro
servidor de Discord, para construir una **comunidad gamer fuerte en LATAM** que
nosotros controlemos y disfrutemos.

Objetivos centrales:
- Conocer y reunir a mucha gente de toda LATAM.
- Crear, manejar y publicitar **eventos** de distintos juegos.
- Participar en eventos de otros y jugar con futuros streamers.
- Tener actividad real (hoy hay ~500 jugadores, pero la mayoría AFK / inactivos).
- Monetizar más adelante con publicidad (fase posterior).

Administradores: **Kimba** y **yo (Sebastián)**.

## 2. Estado actual

- Base de ~500 jugadores en Discord, mayoría AFK o que no entran.
- Objetivo inmediato: **generar actividad** antes de meter publicidad.
- Existe un sitio web (ubicación / stack por confirmar).
- Repositorio local: por ahora vacío (`e:\Omeganetics Corp`).

## 3. Funcionalidades de la plataforma (ideas)

### 3.1 Eventos
- Sección para **publicar nuestros eventos** y los de la comunidad.
- Los miembros pueden **subir sus propios eventos** llenando un formulario.
- Flujo de **aprobación**: Kimba y yo (admins) revisamos y aprobamos antes de publicar.

**Formulario de evento (campos):**
- Juego del evento (ej: Minecraft)
- Nombre del evento (ej: "Survival Zombie")
- Descripción (ej: "Servidor con amigos para sobrevivir a un apocalipsis zombie hecho por nosotros.")
- Duración esperada del evento
- Fecha de inicio
- Fecha de fin (opcional)
- Archivos necesarios para el juego (opcional)

### 3.2 Moneda virtual
- La gente puede **comprar nuestra moneda virtual**.
- Usos posibles: premios, recompensas, desbloqueos, etc.

### 3.3 Contenido de la comunidad
- Agregar **juegos, mods y cosas que creemos como comunidad**.
- Posibilidad de adjuntar archivos / descargas asociadas.

### 3.4 Rankings y premios
- **Usuario más activo / más relevante**.
- Otros rankings de la comunidad.
- **Dar premios** (posible integración con la moneda virtual).

### 3.5 Juegos más activos del servidor (en vivo) — ✅ BOT FUNCIONANDO (2026-06-02)
> El bot ya lee la presencia del servidor y expone el ranking en
> `GET http://localhost:3001/api/active-games`. Filtra apps que no son juegos
> (editable en `bot/non-games.json`) y agrupa sin importar mayúsculas.
> Pendiente: mostrarlo en la web (Next.js) + persistencia/historial.

- Página que muestra **qué se está jugando ahora** en el servidor de Discord.
- Ejemplo: si hay 10 jugadores activos y 5 juegan Minecraft, 3 Valorant y 2 Counter,
  se listan esos 3 juegos como "juegos activos del servidor", del más jugado al menos.
- Sirve como termómetro de **cómo se está manejando el servidor**.
- También mostrar historial: si la gente arma sus propios eventos/servidores
  (ej: su servidor de Minecraft), que puedan subir esos datos a la plataforma.

## 4. Integración con Claude (yo) vía API

Quiero una **API** en la plataforma (y si se puede, acceso al servidor de Discord)
para que Claude pueda **acceder y manejar tanto cosas del servidor como de la
plataforma**, y trabajar juntos en implementaciones y mejoras.

(Ver sección de guía técnica en la conversación / archivo de arquitectura.)

## 5. Fases

- **Fase 0 — Cimientos (ahora):** definir stack, levantar API de la plataforma,
  crear bot/aplicación de Discord, conectar a Claude.
- **Fase 1 — Actividad:** features que generen actividad (eventos, juegos activos,
  rankings) para reactivar a los ~500 jugadores.
- **Fase 2 — Economía:** moneda virtual, premios, contenido de comunidad.
- **Fase 3 — Publicidad / monetización.**

## 5.1 Decisiones tomadas (2026-06-02)

- **Stack:** Next.js + PostgreSQL (decisión: "tú decides").
- **Primer paso:** Bot de Discord + feature "juegos activos del servidor".
- **Sitio web actual:** Sebastián pasará el acceso/link para revisarlo.
- Entorno local listo: Node v24, npm 11, git.

## 6. Pendientes / preguntas abiertas

- ¿Dónde está y con qué tecnología está hecho el sitio web actual?
- ¿Qué stack queremos para la plataforma?
- Definir pasarela de pago para la moneda virtual (según país/LATAM).
- Definir reglas exactas de "actividad" para rankings.
