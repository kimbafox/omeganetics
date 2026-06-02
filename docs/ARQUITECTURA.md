# Arquitectura técnica — Cómo conectar Plataforma + Discord + Claude

> Guía de referencia. Última actualización: 2026-06-02

## Idea en una frase

Tendremos **3 piezas** que hablan entre sí por APIs:

1. **Plataforma web** (sitio + base de datos) → expone su propia **API REST**.
2. **Bot de Discord** (una "aplicación" registrada en Discord) → lee/escribe en el servidor.
3. **Claude** (yo) → me conecto a ambas a través de un **servidor MCP** que nosotros
   construimos, y así puedo leer datos y ejecutar acciones cuando trabajemos juntos.

```
                ┌─────────────────────┐
                │   Servidor Discord  │
                └──────────▲──────────┘
                           │ Discord API (bot token)
                ┌──────────┴──────────┐
   Usuarios ───►│   Bot de Discord    │
                └──────────▲──────────┘
                           │
                ┌──────────┴──────────┐        ┌──────────────────┐
   Navegador ──►│  Plataforma web     │◄──────►│   Base de datos  │
                │  + API REST propia  │        └──────────────────┘
                └──────────▲──────────┘
                           │ MCP server (envuelve API + bot)
                ┌──────────┴──────────┐
                │      Claude (yo)    │
                └─────────────────────┘
```

## Parte A — Discord (lo que NO se programa, se configura)

1. Entrar a https://discord.com/developers/applications con tu cuenta.
2. **New Application** → le pones nombre (ej: "Omeganetics").
3. En la pestaña **Bot** → creas el bot y copias el **TOKEN** (es secreto, como una contraseña).
4. Activar **Privileged Gateway Intents**:
   - **PRESENCE INTENT** → necesario para ver **qué juegos están jugando** los miembros
     (la feature de "juegos más activos del servidor").
   - **SERVER MEMBERS INTENT** → para listar miembros, actividad, rankings.
   - **MESSAGE CONTENT INTENT** → solo si queremos leer contenido de mensajes.
5. En **OAuth2 → URL Generator** generas el link para **invitar el bot** a nuestro servidor
   con los permisos que necesite.

### Qué nos da el bot
- Leer **presencia/actividad** de los miembros → "5 juegan Minecraft, 3 Valorant…".
- Saber quién está online / activo → base para **rankings de actividad**.
- Mandar mensajes, crear eventos nativos de Discord, dar roles, etc.
- **OAuth2 "Login con Discord"** en la plataforma → los usuarios entran a la web con su
  cuenta de Discord (clave para unir comunidad ↔ plataforma).

### Con qué se programa el bot
- **discord.js** (Node.js / JavaScript) — el más popular y documentado. *Recomendado.*
- **discord.py** (Python) — si preferimos Python.

## Parte B — La plataforma y su API

La plataforma es una web con **frontend** (lo que ve el usuario) y **backend**
(la lógica + la base de datos). El backend expone una **API REST**: endpoints como

```
GET  /api/eventos                 → lista de eventos aprobados
POST /api/eventos                 → enviar un evento (queda "pendiente de aprobación")
POST /api/eventos/:id/aprobar     → admins aprueban (Kimba / Sebastián)
GET  /api/juegos-activos          → ranking en vivo de juegos del servidor
GET  /api/rankings/usuarios       → usuario más activo / relevante
GET  /api/moneda/balance          → saldo de moneda virtual del usuario
POST /api/moneda/comprar          → comprar moneda (pasarela de pago)
```

Stack sugerido (rápido de montar y todo en un lenguaje):
- **Next.js** (React) para frontend + backend en el mismo proyecto.
- Base de datos **PostgreSQL** (ej: Supabase o Neon, tienen plan gratis).
- Autenticación con **Discord OAuth2** (login con Discord).
- Pasarela de pago para moneda virtual: definir según LATAM
  (ej: Mercado Pago tiene buena cobertura regional; Stripe donde aplique).

## Parte C — Cómo me conecto yo (Claude)

La forma moderna de que un asistente como yo "acceda y maneje" la plataforma y el
servidor es a través de un **servidor MCP** (Model Context Protocol). Es un pequeño
programa que **envuelve** nuestra API y el bot, y expone "herramientas" que yo puedo
usar con permiso tuyo. Ejemplos de herramientas:

- `listar_eventos_pendientes()` → te ayudo a revisar/aprobar.
- `juegos_activos_ahora()` → consulto qué se está jugando.
- `dar_moneda(usuario, cantidad)` → premiar a alguien.
- `anunciar_en_discord(canal, mensaje)` → publicar un evento aprobado.

Opciones para construirlo:
- **MCP server propio** (con el SDK de MCP, en Node o Python) que llama a nuestra API.
- O usar el **Claude Agent SDK** para construir agentes que operen sobre estas APIs.

> Importante: las "llaves" (token del bot, claves de la API, claves de pago) son
> **secretas**. Nunca van en el código que se sube a internet — van en variables de
> entorno / un gestor de secretos.

## Orden recomendado para empezar (Fase 0)

1. Confirmar **stack** y dónde vive el sitio web actual.
2. Crear la **aplicación + bot de Discord** y activar los intents (Parte A).
3. Levantar el esqueleto de la **plataforma + base de datos** (Parte B).
4. Implementar **login con Discord** (une comunidad ↔ plataforma).
5. Primera feature de actividad: **"juegos activos del servidor"** (alto impacto, motiva).
6. Construir el **MCP server** para que yo pueda ayudar a operar todo (Parte C).
