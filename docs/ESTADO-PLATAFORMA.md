# Estado de la plataforma — qué tenemos vs. qué falta

> Análisis para revisar con Kimba. Fecha: 2026-06-02.
> Basado en TODAS las ideas mencionadas. Aún NO construimos las features nuevas;
> esto es para decidir prioridades.

## ✅ Lo que YA tenemos (gran ventaja, no hay que hacerlo de cero)

La web omeganetics.com ya es una app **Express + PostgreSQL desplegada en Railway**, con:

- **Sitio/landing** funcionando (index.html, perfiles, etc.).
- **Sistema de Equipo**: API `/api/team/*` + panel admin (`admin-equipo.html`) para editar
  integrantes, grupos de trabajo y contactos. Perfiles públicos (kimba, sebillas, anxpo…).
- **Login de ADMIN** ya hecho: Google + clave, con JWT. (Hoy 1 solo admin: juegocrisger@gmail.com.)
- **TIENDITA** (tienda): backend con productos/proyectos, auth y subida de archivos. `/tiendita`.
- **Wiki**: `/wiki`.
- **Subida de imágenes/archivos**: multer + Cloudinary.
- **Base de datos PostgreSQL** (crea tablas sola, migraciones).
- **Despliegue automático en Railway** (push a `main` = sale en vivo).
- **Bot de Discord (NUEVO, hecho por nosotros)**: lee la presencia del servidor y calcula
  los "juegos activos" (filtra apps que no son juegos, agrupa). Funciona en local.

## 🟡 Lo que está A MEDIAS

| Feature | Qué hay | Qué falta |
|---|---|---|
| **Juegos activos del servidor** | Bot funcionando en local | Mostrarlo en la web + desplegar el bot 24/7 en Railway + guardar historial |
| **Contenido de comunidad (juegos/mods)** | Existe TIENDITA + Wiki + subida de archivos | Decidir DÓNDE vive y cómo se organiza |
| **Integración con Claude** | La API ya existe; el bot da control de Discord | Falta conector (MCP/agente) para que yo opere todo |

## ❌ Lo que FALTA por completo

| Feature (de lo que mencionaste) | Notas |
|---|---|
| **Eventos** (crear, formulario, aprobación de admins, listado) | La feature grande. Necesita módulo nuevo + base de datos. |
| **Subir datos de eventos/servidores propios** (ej: server de Minecraft) | Parte del módulo de eventos. |
| **Moneda virtual** (comprar, saldo, usar) | Necesita pasarela de pago para LATAM. |
| **Rankings** (usuario más activo/relevante) + **premios** | Necesita definir cómo se mide "actividad" y login de usuarios. |
| **Login de USUARIOS con Discord** | Hoy solo hay login de admin. **Pieza fundamental** (ver abajo). |
| **Despliegue del bot 24/7** | Segundo servicio en Railway, compartiendo la misma BD. |

## 🔑 El "candado" más importante a decidir: Login de usuarios con Discord

Hoy la web solo tiene **login de admin**. Pero casi todo lo que quieres es **por usuario**:
- "usuario más activo" → necesitas usuarios identificados.
- moneda virtual → cada quién su saldo.
- eventos creados por la gente → saber quién los creó.
- premios → a quién.

➡️ **El "Login con Discord"** (que cada uno de los ~500 entre con su cuenta de Discord)
es la base que habilita eventos-por-usuario, moneda, rankings y premios. Conviene decidir
esto temprano porque casi todo lo demás cuelga de aquí. (Ya tenemos el `CLIENT_SECRET`
pendiente de regenerar para esto.)

## 🧭 Orden lógico sugerido (para discutir, no definitivo)

1. **Juegos activos en la web** + desplegar el bot → victoria visible y rápida, da actividad.
2. **Login con Discord** para usuarios → la base de todo lo demás.
3. **Eventos** (formulario + aprobación) → tu feature central.
4. **Rankings** de actividad (usando datos del bot/Discord) → motiva a los ~500.
5. **Moneda virtual** + premios → economía de la comunidad.
6. **Conector con Claude** (MCP) → para operar plataforma + servidor juntos.

## ❓ Decisiones para la llamada con Kimba

- ¿Los usuarios entran con **login de Discord**? (recomendado, base de todo)
- Agregar a **Kimba y Sebastián** como admins (hoy hay 1 solo).
- **Cómo medir "actividad"** para rankings: ¿mensajes? ¿tiempo en voz? ¿juegos jugados? ¿eventos creados?
- **Pasarela de pago** para la moneda (ej: Mercado Pago tiene buena cobertura LATAM).
- ¿La **moneda** se usa en la TIENDITA? ¿Qué se vende?
- ¿Dónde viven los **juegos/mods de comunidad**: TIENDITA, Wiki, o sección nueva?
- **Premios**: ¿qué se da y cómo se entrega?
