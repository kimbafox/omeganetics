require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "juegocrisger@gmail.com").toLowerCase();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const teamDataDir = path.join(__dirname, "data");
const teamDataFile = path.join(teamDataDir, "equipo.json");
const teamUploadsDir = path.join(__dirname, "uploads", "team");

if (!fs.existsSync(teamDataDir)) {
  fs.mkdirSync(teamDataDir, { recursive: true });
}

if (!fs.existsSync(teamUploadsDir)) {
  fs.mkdirSync(teamUploadsDir, { recursive: true });
}

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET no configurado: se usara una clave temporal para esta ejecucion.");
}

if (!GOOGLE_CLIENT_ID) {
  console.warn("GOOGLE_CLIENT_ID no configurado: el panel admin de equipo quedara deshabilitado.");
}

if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
  console.warn("ADMIN_PASSWORD/ADMIN_PASSWORD_HASH no configurado: el acceso por clave del panel admin quedara deshabilitado.");
}

app.use(express.json({ limit: "2mb" }));
app.use("/uploads/team", express.static(teamUploadsDir));

const uploadStorage = multer.diskStorage({
  destination: teamUploadsDir,
  filename(req, file, cb) {
    const safeBaseName = String(path.basename(file.originalname, path.extname(file.originalname)))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "imagen";

    cb(null, `${Date.now()}-${safeBaseName}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const uploadTeamImage = multer({ storage: uploadStorage });

function normalizeSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeContacts(contacts) {
  return {
    email: normalizeText(contacts?.email),
    phone: normalizeText(contacts?.phone),
    instagram: normalizeText(contacts?.instagram),
    tiktok: normalizeText(contacts?.tiktok),
    discord: normalizeText(contacts?.discord),
    website: normalizeText(contacts?.website)
  };
}

function sanitizeLocation(location) {
  return {
    country: normalizeText(location?.country),
    city: normalizeText(location?.city)
  };
}

function sanitizeMember(member, fallbackIndex = 0) {
  const name = normalizeText(member?.name);
  const slug = normalizeSlug(member?.slug || name || `integrante-${fallbackIndex + 1}`);

  return {
    id: normalizeText(member?.id) || slug,
    slug,
    name,
    fullName: normalizeText(member?.fullName),
    role: normalizeText(member?.role),
    tier: normalizeText(member?.tier),
    badge: normalizeText(member?.badge),
    image: normalizeText(member?.image),
    shortBio: normalizeText(member?.shortBio),
    summary: normalizeText(member?.summary),
    lifeStory: normalizeText(member?.lifeStory),
    specialties: Array.isArray(member?.specialties)
      ? member.specialties.map(item => normalizeText(item)).filter(Boolean)
      : [],
    location: sanitizeLocation(member?.location),
    contacts: sanitizeContacts(member?.contacts),
    featured: Boolean(member?.featured)
  };
}

function sanitizeWorkgroupEntry(entry, fallbackIndex = 0) {
  const name = normalizeText(entry?.name);
  return {
    id: normalizeText(entry?.id) || `grupo-${fallbackIndex + 1}`,
    name,
    role: normalizeText(entry?.role),
    image: normalizeText(entry?.image),
    description: normalizeText(entry?.description),
    location: sanitizeLocation(entry?.location)
  };
}

function createDefaultMemberWorkgroup(member, index = 0) {
  const memberName = normalizeText(member?.name) || `Integrante ${index + 1}`;
  const memberRole = normalizeText(member?.role) || normalizeText(member?.tier) || "Lider";

  return {
    title: `Equipo de ${memberName}`,
    description: `${memberName} lidera este equipo de trabajo dentro de Omeganetics.`,
    members: [
      sanitizeWorkgroupEntry({
        id: `${normalizeSlug(member?.slug || memberName)}-staff-1`,
        name: `${memberName} Support`,
        role: `Apoyo de ${memberRole}`,
        image: normalizeText(member?.image) || "assets/logo.png",
        description: `Soporte operativo asignado al equipo de ${memberName}.`,
        location: member?.location || {}
      }, 0)
    ]
  };
}

function shouldSeedDefaultMemberWorkgroup(member) {
  const slug = normalizeSlug(member?.slug || member?.name);
  return slug === "emperador-kimba" || slug === "sebillas" || slug === "anxpo";
}

function upgradeLegacyMemberWorkgroups(content) {
  const members = Array.isArray(content?.members) ? content.members : [];

  return {
    ...content,
    members: members.map((member, index) => {
      const sanitizedWorkgroup = sanitizeMemberWorkgroup(member?.workgroup);
      const hasOwnWorkgroup = sanitizedWorkgroup.title || sanitizedWorkgroup.description || sanitizedWorkgroup.members.length;

      if (hasOwnWorkgroup || !shouldSeedDefaultMemberWorkgroup(member)) {
        return {
          ...member,
          workgroup: sanitizedWorkgroup
        };
      }

      return {
        ...member,
        workgroup: createDefaultMemberWorkgroup(member, index)
      };
    })
  };
}

function sanitizeMemberWorkgroup(workgroup) {
  const members = Array.isArray(workgroup?.members) ? workgroup.members : [];

  return {
    title: normalizeText(workgroup?.title),
    description: normalizeText(workgroup?.description),
    members: members.map((entry, index) => sanitizeWorkgroupEntry(entry, index))
  };
}

function sanitizeTeamContent(content) {
  const upgradedContent = upgradeLegacyMemberWorkgroups(content || {});
  const members = Array.isArray(upgradedContent?.members) ? upgradedContent.members : [];
  const crew = Array.isArray(upgradedContent?.workgroup?.members) ? upgradedContent.workgroup.members : [];

  return {
    about: {
      eyebrow: normalizeText(upgradedContent?.about?.eyebrow),
      title: normalizeText(upgradedContent?.about?.title),
      description: normalizeText(upgradedContent?.about?.description)
    },
    members: members.map((member, index) => ({
      ...sanitizeMember(member, index),
      workgroup: sanitizeMemberWorkgroup(member?.workgroup)
    })),
    workgroup: {
      title: normalizeText(upgradedContent?.workgroup?.title),
      description: normalizeText(upgradedContent?.workgroup?.description),
      members: crew.map((entry, index) => sanitizeWorkgroupEntry(entry, index))
    }
  };
}

async function getPublicTeamContent() {
  const content = await readTeamContent();
  return sanitizeTeamContent(content);
}

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    const error = new Error("google_not_configured");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    const error = new Error("invalid_google_token");
    error.statusCode = 401;
    throw error;
  }

  const payload = await response.json();
  if (payload.aud !== GOOGLE_CLIENT_ID) {
    const error = new Error("google_audience_mismatch");
    error.statusCode = 401;
    throw error;
  }

  if (payload.email_verified !== "true" || !payload.email) {
    const error = new Error("google_email_not_verified");
    error.statusCode = 401;
    throw error;
  }

  return payload;
}

async function validateAdminPassword(password) {
  if (!password || (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH)) {
    return false;
  }

  if (ADMIN_PASSWORD_HASH) {
    return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  }

  return password === ADMIN_PASSWORD;
}

function createAdminToken(email, name = email) {
  return jwt.sign(
    {
      role: "admin",
      email,
      name
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function requireTeamAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Autenticacion requerida." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" || String(decoded.email || "").toLowerCase() !== ADMIN_EMAIL) {
      return res.status(403).json({ error: "Solo el administrador autorizado puede editar este contenido." });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Sesion expirada o invalida." });
  }
}

// Redirige a HTTPS solo en produccion detras de proxy (Railway/Heroku-like).
app.use((req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  const proto = req.headers["x-forwarded-proto"];

  if (isProduction && proto && proto !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// Sitio principal Omeganetics
app.use(express.static(__dirname));

let tienditaEnabled = false;
let initDatabase = async () => {};
let teamPool = null;
let teamStorageMode = "file";
const LEGACY_TEAM_CONTENT_KEY = "main";
const TEAM_SCOPE_KEY = "main";

function resolveDatabaseUrl() {
  const directCandidates = [
    "DATABASE_URL",
    "DATABASE_PUBLIC_URL",
    "DATABASE_PRIVATE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_URI",
    "POSTGRES_PRISMA_URL",
    "POSTGRESQL_URL",
    "PG_URL"
  ];

  for (const key of directCandidates) {
    const value = process.env[key];
    if (value && /^postgres(ql)?:\/\//i.test(value)) {
      return value;
    }
  }

  // Busca cualquier variable que parezca URL de Postgres.
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const looksLikeDbKey = /(database|postgres|pg).*(url|uri)/i.test(key);
    const looksLikeDbValue = /^postgres(ql)?:\/\//i.test(value);
    if (looksLikeDbKey && looksLikeDbValue) {
      return value;
    }
  }

  const {
    PGHOST,
    PGPORT,
    PGUSER,
    PGPASSWORD,
    PGDATABASE
  } = process.env;

  if (PGHOST && PGPORT && PGUSER && PGPASSWORD && PGDATABASE) {
    const user = encodeURIComponent(PGUSER);
    const password = encodeURIComponent(PGPASSWORD);
    const database = encodeURIComponent(PGDATABASE);
    return `postgresql://${user}:${password}@${PGHOST}:${PGPORT}/${database}`;
  }

  const {
    POSTGRES_HOST,
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB
  } = process.env;

  if (POSTGRES_HOST && POSTGRES_PORT && POSTGRES_USER && POSTGRES_PASSWORD && POSTGRES_DB) {
    const user = encodeURIComponent(POSTGRES_USER);
    const password = encodeURIComponent(POSTGRES_PASSWORD);
    const database = encodeURIComponent(POSTGRES_DB);
    return `postgresql://${user}:${password}@${POSTGRES_HOST}:${POSTGRES_PORT}/${database}`;
  }

  return null;
}

const resolvedDatabaseUrl = resolveDatabaseUrl();

if (resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;

  teamPool = new Pool({
    connectionString: resolvedDatabaseUrl,
    ssl: resolvedDatabaseUrl.includes("railway")
      ? { rejectUnauthorized: false }
      : false
  });
  teamStorageMode = "database";
}

function readTeamContentFromFile() {
  const raw = fs.readFileSync(teamDataFile, "utf8");
  return JSON.parse(raw);
}

function writeTeamContentToFile(content) {
  fs.writeFileSync(teamDataFile, JSON.stringify(content, null, 2));
}

async function createTeamSchema() {
  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_about (
      scope_key TEXT PRIMARY KEY,
      eyebrow TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT '',
      badge TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      short_bio TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      life_story TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_member_contacts (
      member_id TEXT PRIMARY KEY REFERENCES team_members(id) ON DELETE CASCADE,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      instagram TEXT NOT NULL DEFAULT '',
      tiktok TEXT NOT NULL DEFAULT '',
      discord TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_member_specialties (
      id BIGSERIAL PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      specialty TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_workgroup (
      scope_key TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_workgroup_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_member_workgroups (
      owner_member_id TEXT PRIMARY KEY REFERENCES team_members(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_member_workgroup_members (
      id TEXT PRIMARY KEY,
      owner_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await teamPool.query("CREATE INDEX IF NOT EXISTS idx_team_members_sort_order ON team_members(sort_order)");
  await teamPool.query("CREATE INDEX IF NOT EXISTS idx_team_workgroup_members_sort_order ON team_workgroup_members(sort_order)");
  await teamPool.query("CREATE INDEX IF NOT EXISTS idx_team_member_specialties_member_order ON team_member_specialties(member_id, sort_order)");
  await teamPool.query("CREATE INDEX IF NOT EXISTS idx_team_member_workgroup_members_owner_order ON team_member_workgroup_members(owner_member_id, sort_order)");
}

async function readLegacyTeamContentFromDatabase() {
  const tableCheck = await teamPool.query("SELECT to_regclass('public.team_content') AS table_name");
  if (!tableCheck.rows[0]?.table_name) {
    return null;
  }

  const result = await teamPool.query(
    "SELECT payload FROM team_content WHERE content_key = $1 LIMIT 1",
    [LEGACY_TEAM_CONTENT_KEY]
  );

  if (!result.rows.length) {
    return null;
  }

  return sanitizeTeamContent(result.rows[0].payload);
}

async function writeTeamContentToDatabase(content) {
  const client = await teamPool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO team_about (scope_key, eyebrow, title, description, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (scope_key)
        DO UPDATE SET eyebrow = EXCLUDED.eyebrow, title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
      `,
      [TEAM_SCOPE_KEY, content.about.eyebrow, content.about.title, content.about.description]
    );

    await client.query(
      `
        INSERT INTO team_workgroup (scope_key, title, description, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (scope_key)
        DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
      `,
      [TEAM_SCOPE_KEY, content.workgroup.title, content.workgroup.description]
    );

    await client.query("DELETE FROM team_member_specialties");
    await client.query("DELETE FROM team_member_contacts");
    await client.query("DELETE FROM team_members");

    for (const [index, member] of content.members.entries()) {
      await client.query(
        `
          INSERT INTO team_members (
            id, slug, name, full_name, role, tier, badge, image, short_bio, summary,
            life_story, country, city, featured, sort_order, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        `,
        [
          member.id,
          member.slug,
          member.name,
          member.fullName,
          member.role,
          member.tier,
          member.badge,
          member.image,
          member.shortBio,
          member.summary,
          member.lifeStory,
          member.location.country,
          member.location.city,
          member.featured,
          index
        ]
      );

      await client.query(
        `
          INSERT INTO team_member_contacts (
            member_id, email, phone, instagram, tiktok, discord, website, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `,
        [
          member.id,
          member.contacts.email,
          member.contacts.phone,
          member.contacts.instagram,
          member.contacts.tiktok,
          member.contacts.discord,
          member.contacts.website
        ]
      );

      for (const [specialtyIndex, specialty] of member.specialties.entries()) {
        await client.query(
          `
            INSERT INTO team_member_specialties (member_id, specialty, sort_order)
            VALUES ($1, $2, $3)
          `,
          [member.id, specialty, specialtyIndex]
        );
      }
    }

    await client.query("DELETE FROM team_member_workgroup_members");
    await client.query("DELETE FROM team_member_workgroups");
    await client.query("DELETE FROM team_workgroup_members");

    for (const [index, member] of content.workgroup.members.entries()) {
      await client.query(
        `
          INSERT INTO team_workgroup_members (
            id, name, role, image, description, country, city, sort_order, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        `,
        [
          member.id,
          member.name,
          member.role,
          member.image,
          member.description,
          member.location.country,
          member.location.city,
          index
        ]
      );
    }

    for (const member of content.members) {
      const workgroup = sanitizeMemberWorkgroup(member.workgroup);

      await client.query(
        `
          INSERT INTO team_member_workgroups (owner_member_id, title, description, updated_at)
          VALUES ($1, $2, $3, NOW())
        `,
        [member.id, workgroup.title, workgroup.description]
      );

      for (const [index, entry] of workgroup.members.entries()) {
        await client.query(
          `
            INSERT INTO team_member_workgroup_members (
              id, owner_member_id, name, role, image, description, country, city, sort_order, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          `,
          [
            entry.id,
            member.id,
            entry.name,
            entry.role,
            entry.image,
            entry.description,
            entry.location.country,
            entry.location.city,
            index
          ]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readTeamContentFromDatabase() {
  const aboutResult = await teamPool.query(
    "SELECT eyebrow, title, description FROM team_about WHERE scope_key = $1 LIMIT 1",
    [TEAM_SCOPE_KEY]
  );

  const workgroupResult = await teamPool.query(
    "SELECT title, description FROM team_workgroup WHERE scope_key = $1 LIMIT 1",
    [TEAM_SCOPE_KEY]
  );

  const membersResult = await teamPool.query(
    `
      SELECT
        m.id,
        m.slug,
        m.name,
        m.full_name,
        m.role,
        m.tier,
        m.badge,
        m.image,
        m.short_bio,
        m.summary,
        m.life_story,
        m.country,
        m.city,
        m.featured,
        m.sort_order,
        c.email,
        c.phone,
        c.instagram,
        c.tiktok,
        c.discord,
        c.website
      FROM team_members m
      LEFT JOIN team_member_contacts c ON c.member_id = m.id
      ORDER BY m.sort_order ASC, m.name ASC
    `
  );

  const specialtiesResult = await teamPool.query(
    `
      SELECT member_id, specialty
      FROM team_member_specialties
      ORDER BY member_id ASC, sort_order ASC, id ASC
    `
  );

  const workgroupMembersResult = await teamPool.query(
    `
      SELECT id, name, role, image, description, country, city
      FROM team_workgroup_members
      ORDER BY sort_order ASC, name ASC
    `
  );

  const memberWorkgroupsResult = await teamPool.query(
    `
      SELECT owner_member_id, title, description
      FROM team_member_workgroups
      ORDER BY owner_member_id ASC
    `
  );

  const memberWorkgroupMembersResult = await teamPool.query(
    `
      SELECT owner_member_id, id, name, role, image, description, country, city
      FROM team_member_workgroup_members
      ORDER BY owner_member_id ASC, sort_order ASC, name ASC
    `
  );

  const specialtyMap = new Map();
  for (const row of specialtiesResult.rows) {
    const list = specialtyMap.get(row.member_id) || [];
    list.push(normalizeText(row.specialty));
    specialtyMap.set(row.member_id, list);
  }

  const memberWorkgroupMap = new Map();
  for (const row of memberWorkgroupsResult.rows) {
    memberWorkgroupMap.set(row.owner_member_id, {
      title: normalizeText(row.title),
      description: normalizeText(row.description),
      members: []
    });
  }

  for (const row of memberWorkgroupMembersResult.rows) {
    const workgroup = memberWorkgroupMap.get(row.owner_member_id) || {
      title: '',
      description: '',
      members: []
    };

    workgroup.members.push({
      id: row.id,
      name: row.name,
      role: row.role,
      image: row.image,
      description: row.description,
      location: {
        country: row.country,
        city: row.city
      }
    });

    memberWorkgroupMap.set(row.owner_member_id, workgroup);
  }

  return sanitizeTeamContent({
    about: aboutResult.rows[0] || {},
    members: membersResult.rows.map(row => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      fullName: row.full_name,
      role: row.role,
      tier: row.tier,
      badge: row.badge,
      image: row.image,
      shortBio: row.short_bio,
      summary: row.summary,
      lifeStory: row.life_story,
      specialties: specialtyMap.get(row.id) || [],
      location: {
        country: row.country,
        city: row.city
      },
      contacts: {
        email: row.email,
        phone: row.phone,
        instagram: row.instagram,
        tiktok: row.tiktok,
        discord: row.discord,
        website: row.website
      },
      featured: row.featured,
      workgroup: memberWorkgroupMap.get(row.id) || { title: '', description: '', members: [] }
    })),
    workgroup: {
      ...(workgroupResult.rows[0] || {}),
      members: workgroupMembersResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        role: row.role,
        image: row.image,
        description: row.description,
        location: {
          country: row.country,
          city: row.city
        }
      }))
    }
  });
}

async function backfillMemberWorkgroups() {
  const result = await teamPool.query(
    `
      SELECT
        m.id,
        m.slug,
        m.name,
        m.role,
        m.tier,
        m.image,
        m.country,
        m.city,
        mw.owner_member_id
      FROM team_members m
      LEFT JOIN team_member_workgroups mw ON mw.owner_member_id = m.id
      ORDER BY m.sort_order ASC, m.name ASC
    `
  );

  const membersToSeed = result.rows
    .filter(row => !row.owner_member_id && shouldSeedDefaultMemberWorkgroup(row))
    .map((row, index) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      role: row.role,
      tier: row.tier,
      image: row.image,
      location: {
        country: row.country,
        city: row.city
      },
      sortIndex: index
    }));

  if (!membersToSeed.length) {
    return;
  }

  const client = await teamPool.connect();

  try {
    await client.query("BEGIN");

    for (const member of membersToSeed) {
      const workgroup = createDefaultMemberWorkgroup(member, member.sortIndex);

      await client.query(
        `
          INSERT INTO team_member_workgroups (owner_member_id, title, description, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (owner_member_id)
          DO NOTHING
        `,
        [member.id, workgroup.title, workgroup.description]
      );

      for (const [index, entry] of workgroup.members.entries()) {
        await client.query(
          `
            INSERT INTO team_member_workgroup_members (
              id, owner_member_id, name, role, image, description, country, city, sort_order, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (id)
            DO NOTHING
          `,
          [
            entry.id,
            member.id,
            entry.name,
            entry.role,
            entry.image,
            entry.description,
            entry.location.country,
            entry.location.city,
            index
          ]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initTeamStorage() {
  if (!teamPool) {
    return;
  }

  await createTeamSchema();

  const status = await teamPool.query(
    `
      SELECT
        EXISTS (SELECT 1 FROM team_about WHERE scope_key = $1) AS has_about,
        EXISTS (SELECT 1 FROM team_members) AS has_members,
        EXISTS (SELECT 1 FROM team_workgroup WHERE scope_key = $1) AS has_workgroup,
        EXISTS (SELECT 1 FROM team_workgroup_members) AS has_workgroup_members
    `,
    [TEAM_SCOPE_KEY]
  );

  const currentStatus = status.rows[0] || {};
  const hasStructuredData = currentStatus.has_about || currentStatus.has_members || currentStatus.has_workgroup || currentStatus.has_workgroup_members;

  if (!hasStructuredData) {
    const legacyContent = await readLegacyTeamContentFromDatabase();
    const seedContent = legacyContent || sanitizeTeamContent(readTeamContentFromFile());
    await writeTeamContentToDatabase(seedContent);
    return;
  }

  await backfillMemberWorkgroups();
}

async function readTeamContent() {
  if (!teamPool) {
    return readTeamContentFromFile();
  }

  return readTeamContentFromDatabase();
}

async function writeTeamContent(content) {
  if (!teamPool) {
    writeTeamContentToFile(content);
    return;
  }

  await writeTeamContentToDatabase(content);
}

app.get("/api/team/auth-config", (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID,
    adminEmail: ADMIN_EMAIL,
    passwordEnabled: Boolean(ADMIN_PASSWORD || ADMIN_PASSWORD_HASH),
    databaseConfigured: Boolean(teamPool),
    storageMode: teamStorageMode
  });
});

app.post("/api/team/login/google", async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (!credential) {
      return res.status(400).json({ error: "Token de Google requerido." });
    }

    const googleUser = await verifyGoogleToken(credential);
    const email = String(googleUser.email || "").toLowerCase();

    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: "Esta cuenta no tiene permisos de administrador." });
    }

    const token = createAdminToken(email, googleUser.name || googleUser.given_name || email);

    return res.json({ token, role: "admin", email });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode === 503
      ? "Google Login no esta configurado en el servidor."
      : "No se pudo validar la cuenta de Google.";

    return res.status(statusCode).json({ error: message });
  }
});

app.post("/api/team/login/password", async (req, res) => {
  try {
    if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
      return res.status(503).json({ error: "El acceso por clave no esta configurado en el servidor." });
    }

    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Correo y clave son obligatorios." });
    }

    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: "Esta cuenta no tiene permisos de administrador." });
    }

    const isValid = await validateAdminPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: "Clave invalida." });
    }

    const token = createAdminToken(email);
    return res.json({ token, role: "admin", email });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo iniciar sesion con clave." });
  }
});

app.get("/api/team/content", async (req, res) => {
  try {
    const content = await getPublicTeamContent();
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: "No se pudo cargar el contenido del equipo." });
  }
});

app.get("/api/team/members/:slug", async (req, res) => {
  try {
    const content = await getPublicTeamContent();
    const member = content.members.find(item => item.slug === normalizeSlug(req.params.slug));

    if (!member) {
      return res.status(404).json({ error: "Integrante no encontrado." });
    }

    return res.json(member);
  } catch (error) {
    return res.status(500).json({ error: "No se pudo cargar el integrante." });
  }
});

app.put("/api/team/content", requireTeamAdmin, async (req, res) => {
  const content = sanitizeTeamContent(req.body);

  try {
    if (!teamPool) {
      return res.status(503).json({ error: "La base de datos de team no esta configurada. Define DATABASE_URL antes de guardar." });
    }

    if (!content.about.title || !content.about.description) {
      return res.status(400).json({ error: "La seccion principal de quienes somos requiere titulo y descripcion." });
    }

    if (!content.members.length) {
      return res.status(400).json({ error: "Debes mantener al menos un integrante." });
    }

    const duplicateSlug = content.members.find((member, index) => {
      return content.members.findIndex(item => item.slug === member.slug) !== index;
    });

    if (duplicateSlug) {
      return res.status(400).json({ error: `El slug ${duplicateSlug.slug} esta repetido.` });
    }

    await writeTeamContent(content);
    return res.json(content);
  } catch (error) {
    return res.status(500).json({ error: "No se pudo guardar el contenido del equipo." });
  }
});

app.post("/api/team/upload", requireTeamAdmin, uploadTeamImage.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Debes enviar una imagen." });
  }

  return res.json({
    imagePath: `/uploads/team/${req.file.filename}`
  });
});

const { app: wikiApp } = require("./mi-wiki-hacker/server");
app.use("/wiki", wikiApp);

if (resolvedDatabaseUrl) {

  const { app: tienditaApp, initDatabase: tienditaInit } = require("./TIENDITA/backend/index");
  tienditaEnabled = true;
  initDatabase = tienditaInit;

  // Frontend de TIENDITA bajo el mismo dominio
  app.use("/tiendita", express.static(path.join(__dirname, "TIENDITA", "frontend")));

  // API + uploads de TIENDITA bajo el mismo servidor
  app.use(tienditaApp);
} else {
  console.warn("TIENDITA deshabilitada: falta configuracion de base de datos (DATABASE_URL/PG*). ");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/tiendita", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.sendFile(path.join(__dirname, "TIENDITA", "frontend", "indextienda.html"));
});

app.get("/tiendita/", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.sendFile(path.join(__dirname, "TIENDITA", "frontend", "indextienda.html"));
});

app.get("/tiendita/index.html", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.redirect("/tiendita/indextienda.html");
});

app.get("/wiki", (req, res) => {
  res.redirect("/wiki/");
});

// iniciar servidor
async function start() {
  try {
    await initTeamStorage();
    await initDatabase();
    app.listen(PORT, "0.0.0.0", () => {
      console.log("Servidor corriendo en puerto", PORT, "| storage equipo:", teamStorageMode);
    });
  } catch (error) {
    console.error("Error iniciando servidor:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
  initTeamStorage
};
