# Roadmap Omeganetics — lista priorizada para construir

> Orden del #1 (hacer primero) a lo menos urgente. Pensado para reactivar a los ~500
> miembros y generar actividad antes de la publicidad. Fecha: 2026-06-02.
> Esfuerzo: 🟢 rápido · 🟡 medio · 🔴 grande.

---

## 🧱 CIMIENTOS (habilitan todo lo demás — primero sí o sí)

**#1 — Desplegar el bot de Discord 24/7 en Railway** 🟢
Hoy el bot solo corre en tu PC. Como segundo servicio en Railway (misma BD) queda
encendido siempre. Desbloquea: juegos activos en vivo, tracking de actividad y que yo
pueda operar el servidor. *Casi listo, solo falta desplegarlo.*

**#2 — Login con Discord para usuarios** 🟡
Que los ~500 entren a la web con su cuenta de Discord. Es el **candado maestro**: sin
usuarios identificados no hay "usuario más activo", ni saldo de moneda, ni saber quién
creó cada evento, ni a quién premiar. Reutilizamos la tabla `usuarios` (hoy vacía).
**Casi todo lo de abajo depende de esto.**

**#3 — Admins reales (Kimba + Sebastián)** 🟢
Hoy hay 1 solo admin (`juegocrisger@gmail.com`). Agregarlos a ambos para aprobar
eventos y moderar. Rápido.

---

## 🔥 ACTIVIDAD VISIBLE (reactivar a los 500 — impacto rápido)

**#4 — Página "Juegos activos del servidor"** 🟢
Mostrar en omeganetics.com lo que ya calcula el bot (Roblox 3, Valorant 2, …). Primer
pedazo de plataforma vivo. Demuestra que el servidor está activo y engancha.

**#5 — Tracking de actividad** 🟡
El bot registra con el tiempo: mensajes, minutos en voz, juegos jugados. Es la materia
prima de los rankings y de la moneda "ganada por actividad".

**#6 — Rankings / Leaderboard (usuario más activo)** 🟡
Tabla de los más activos de la semana/mes. Competencia sana = más actividad. Necesita #5
(y #2 para ligarlo al perfil web).

**#7 — Sistema de XP / niveles + roles automáticos** 🟡
Ganar XP por participar y subir de nivel (rol automático en Discord al llegar a X). Es el
motor de engagement clásico de comunidades gamer. Se alimenta de #5.

**#8 — Bienvenida / onboarding de nuevos** 🟢
El bot saluda al que entra, le explica la comunidad y le da rol según sus juegos. Mejora
retención desde el minuto 1.

---

## 🎯 FEATURES CENTRALES (lo que pediste)

**#9 — Eventos: crear + aprobar + listar** 🔴
Formulario (juego, nombre, descripción, duración, fechas, archivos opcionales), flujo de
aprobación de admins, y listado público. Tu feature estrella. Necesita #2 y #3.

**#10 — Subir eventos/servidores propios** 🟡
Que la gente suba sus servidores (ej: su Minecraft) con sus datos/archivos. Extensión de #9.

**#11 — Moneda virtual (ganar)** 🟡
Saldo por usuario; se gana por actividad/eventos. Arrancar SIN dinero real (solo ganada).
Necesita #2 y #5.

**#12 — Premios / recompensas** 🟡
Canjear moneda o premiar a los tops de los rankings. Necesita #6 y #11.

**#13 — Contenido de comunidad (juegos/mods/descargas)** 🟡
Sección para publicar juegos, mods y cosas creadas por la comunidad, con archivos.
Podemos apoyarnos en la TIENDITA y la subida de archivos que ya existen.

---

## 🚀 CRECIMIENTO Y STREAMERS

**#14 — Anuncios automáticos en Discord** 🟢
Evento aprobado → el bot lo publica en el canal correspondiente. Cierra el ciclo web↔Discord.

**#15 — Alertas de streamers (Twitch/Kick en vivo)** 🟡
Cuando un miembro/streamer aliado va en vivo, el bot avisa en Discord. Apoya tu meta de
invitar streamers y jugar con ellos.

**#16 — Torneos / brackets** 🔴
Inscripción y llaves para torneos (Valorant, Yu-Gi-Oh, etc.). Genera eventos grandes y atrae gente.

**#17 — Perfil público de usuario** 🟡
Página de cada miembro: su actividad, sus eventos, sus logros, su saldo. Da identidad y orgullo.

---

## 🤖 INTEGRACIÓN CON CLAUDE Y OPERACIÓN

**#18 — Conector MCP (que yo opere plataforma + servidor)** 🟡
Herramientas para que yo, con tu permiso, liste/aprobe eventos, dé moneda, anuncie en
Discord, consulte rankings, etc. Trabajamos juntos en las mejoras.

**#19 — Panel admin unificado** 🟡
Un lugar para moderar eventos, usuarios, moneda y rankings sin tocar código.

---

## 🧩 ÚTILES PERO MENOS URGENTES

**#20 — Logros / badges** 🟡 — insignias por hitos (primer evento, top del mes…).
**#21 — Pasarela de pago real (Mercado Pago u otra LATAM)** 🟡 — comprar moneda con dinero real (cuando escale).
**#22 — Notificaciones (email/push)** 🟡 — avisos de eventos, premios, etc.
**#23 — Métricas/analytics del servidor** 🟡 — historial y gráficas de cómo crece la comunidad.
**#24 — Pulido de diseño / multi-idioma** 🟢 — mejoras visuales y de experiencia.

---

## Resumen del orden recomendado para EMPEZAR

> **#1 Desplegar bot → #2 Login Discord → #3 Admins → #4 Juegos activos → #5 Tracking →
> #6 Rankings → #9 Eventos → … →** el resto en cascada.

La regla: primero lo que **habilita** (1-3), luego lo que **da actividad rápida** (4-8),
luego tus **features centrales** (9-13), y después **crecimiento** (14-17) e **integración** (18+).
