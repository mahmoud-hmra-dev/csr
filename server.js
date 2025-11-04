
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Static files (frontends)
app.use(express.static(path.join(__dirname, "public")));

// --- MySQL pool ---
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = parseInt(process.env.DB_PORT || "3306", 10);
const dbUser = process.env.DB_USER || "root";
const dbPassword = process.env.DB_PASSWORD || "";
const dbName = process.env.DB_NAME || "csr_db";

const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-me";

// --- Helpers ---

async function getUserById(id) {
  const [rows] = await pool.execute(
    "SELECT id, email, name, role, org_kind, org_size, org_type, annual_budget, extra_json FROM users WHERE id = ?",
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.extra_json && typeof row.extra_json === "string") {
    try { row.extra = JSON.parse(row.extra_json); } catch { row.extra = null; }
  } else {
    row.extra = row.extra_json;
  }
  delete row.extra_json;
  return row;
}

function orgTypeFrom(kind, size) {
  if (kind === "ngo") {
    return size === "large" ? "large_ngo" : "small_ngo";
  }
  return size === "large" ? "large_corporate" : "small_corporate";
}

async function computeOrgSize(kind, annualBudget) {
  try {
    const [rows] = await pool.query(
      "SELECT ngo_threshold, corporate_threshold FROM budget_rules WHERE id = 1"
    );
    const row = rows[0] || { ngo_threshold: 1000000, corporate_threshold: 1000000 };
    const threshold = kind === "ngo" ? row.ngo_threshold : row.corporate_threshold;
    const budget = Number(annualBudget || 0);
    const size = budget >= threshold ? "large" : "small";
    return { size, threshold };
  } catch (err) {
    // If table not found yet, default
    const budget = Number(annualBudget || 0);
    const threshold = 1000000;
    const size = budget >= threshold ? "large" : "small";
    return { size, threshold };
  }
}

function authMiddleware(requireAdmin = false) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) {
        return res.status(401).json({ ok: false, error: "NO_TOKEN" });
      }
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await getUserById(payload.id);
      if (!user) {
        return res.status(401).json({ ok: false, error: "USER_NOT_FOUND" });
      }
      if (requireAdmin && user.role !== "admin") {
        return res.status(403).json({ ok: false, error: "FORBIDDEN" });
      }
      req.user = user;
      next();
    } catch (err) {
      console.error("authMiddleware error", err);
      return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
    }
  };
}

// --- API: questions ---
app.get("/api/questions", (req, res) => {
  const dataPath = path.join(__dirname, "questions.json");
  const raw = fs.readFileSync(dataPath, "utf-8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(raw);
});

// --- API: register user ---
app.post("/api/register", async (req, res) => {
  try {
    const { kind, email, password, name, annualBudget, extra } = req.body || {};

    if (!kind || !["ngo", "corporate"].includes(kind)) {
      return res.status(400).json({ ok: false, error: "INVALID_KIND" });
    }
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "EMAIL_PASSWORD_REQUIRED" });
    }

    const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) {
      return res.status(400).json({ ok: false, error: "EMAIL_EXISTS" });
    }

    const { size } = await computeOrgSize(kind, annualBudget);
    const orgType = orgTypeFrom(kind, size);
    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash, name, role, org_kind, org_size, org_type, annual_budget, extra_json, created_at, updated_at)
       VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        email,
        hash,
        name || null,
        kind,
        size,
        orgType,
        annualBudget != null ? Number(annualBudget) : null,
        JSON.stringify(extra || {}),
      ]
    );

    const id = result.insertId;
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });
    const user = await getUserById(id);
    res.json({ ok: true, token, user });
  } catch (err) {
    console.error("Register error", err);
    res.status(500).json({ ok: false, error: "REGISTER_ERROR" });
  }
});

// --- API: login ---
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "EMAIL_PASSWORD_REQUIRED" });
    }
    const [rows] = await pool.execute(
      "SELECT id, email, password_hash, name, role, org_kind, org_size, org_type, annual_budget, extra_json FROM users WHERE email = ?",
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.status(400).json({ ok: false, error: "INVALID_CREDENTIALS" });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ ok: false, error: "INVALID_CREDENTIALS" });
    }
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });
    if (user.extra_json && typeof user.extra_json === "string") {
      try { user.extra = JSON.parse(user.extra_json); } catch { user.extra = null; }
    } else {
      user.extra = user.extra_json;
    }
    delete user.password_hash;
    delete user.extra_json;
    res.json({ ok: true, token, user });
  } catch (err) {
    console.error("Login error", err);
    res.status(500).json({ ok: false, error: "LOGIN_ERROR" });
  }
});

// --- API: current user ---
app.get("/api/me", authMiddleware(false), async (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.put("/api/me", authMiddleware(false), async (req, res) => {
  try {
    const { name, password, annualBudget, extra } = req.body || {};

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name = ?");
      params.push(name);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push("password_hash = ?");
      params.push(hash);
    }

    // Allow updating of extra JSON data (organization profile fields)
    if (extra && typeof extra === "object") {
      const mergedExtra = { ...(req.user.extra || {}), ...extra };
      updates.push("extra_json = ?");
      params.push(JSON.stringify(mergedExtra));
    }

    // Allow updating of annual budget and recompute org size/type
    if (annualBudget !== undefined && annualBudget !== null && annualBudget !== "") {
      const budgetNum = Number(annualBudget);
      const { size } = await computeOrgSize(req.user.org_kind, budgetNum);
      const orgType = orgTypeFrom(req.user.org_kind, size);
      updates.push("annual_budget = ?");
      params.push(isNaN(budgetNum) ? null : budgetNum);
      updates.push("org_size = ?");
      params.push(size);
      updates.push("org_type = ?");
      params.push(orgType);
    }

    if (!updates.length) {
      return res.json({ ok: true, user: req.user });
    }

    params.push(req.user.id);
    const sql = `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`;
    await pool.execute(sql, params);
    const fresh = await getUserById(req.user.id);
    res.json({ ok: true, user: fresh });
  } catch (err) {
    console.error("Update me error", err);
    res.status(500).json({ ok: false, error: "UPDATE_ME_ERROR" });
  }
});

// --- API: submit survey ---
app.post("/api/submit", authMiddleware(false), async (req, res) => {
  try {
    const { submittedAt, lang, answers } = req.body || {};
    const submitted = submittedAt ? new Date(submittedAt) : new Date();
    const answersJson = JSON.stringify(answers || {});
    const orgType = req.user.org_type;

    const sql = `
      INSERT INTO responses (user_id, submitted_at, lang, organization_type, answers)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      req.user.id,
      submitted.toISOString().slice(0, 19).replace("T", " "),
      lang || null,
      orgType || null,
      answersJson,
    ];
    const [result] = await pool.execute(sql, params);
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error("Submit error", err);
    res.status(500).json({ ok: false, error: "SUBMIT_ERROR" });
  }
});

// --- Admin: budget rules ---
app.get("/api/admin/budget-rules", authMiddleware(true), async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT ngo_threshold, corporate_threshold FROM budget_rules WHERE id = 1"
    );
    const row =
      rows[0] || { ngo_threshold: 1000000, corporate_threshold: 1000000 };
    res.json({ ok: true, rules: row });
  } catch (err) {
    console.error("Admin budget rules error", err);
    res.status(500).json({ ok: false, error: "ADMIN_BUDGET_RULES_ERROR" });
  }
});

app.put("/api/admin/budget-rules", authMiddleware(true), async (req, res) => {
  try {
    const { ngo_threshold, corporate_threshold } = req.body || {};
    const ngo = Number(ngo_threshold || 0);
    const corp = Number(corporate_threshold || 0);
    await pool.execute(
      `INSERT INTO budget_rules (id, ngo_threshold, corporate_threshold)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE ngo_threshold = VALUES(ngo_threshold), corporate_threshold = VALUES(corporate_threshold)`,
      [ngo, corp]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Admin budget rules update error", err);
    res.status(500).json({ ok: false, error: "ADMIN_BUDGET_RULES_UPDATE_ERROR" });
  }
});


// --- Admin: list users (organizations & companies) ---
app.get("/api/admin/users", authMiddleware(true), async (req, res) => {
  try {
    const sql = `
      SELECT id, email, name, role, org_kind, org_size, org_type,
             annual_budget, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 500
    `;
    const [rows] = await pool.query(sql);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("Admin users error", err);
    res.status(500).json({ ok: false, error: "ADMIN_USERS_ERROR" });
  }
});

// --- Admin: list responses ---
app.get("/api/admin/responses", authMiddleware(true), async (req, res) => {
  try {
    const sql = `
      SELECT r.id, r.submitted_at, r.lang, r.organization_type,
             r.answers,
             u.email, u.name, u.org_kind, u.org_size, u.org_type
      FROM responses r
      LEFT JOIN users u ON r.user_id = u.id
      ORDER BY r.submitted_at DESC
      LIMIT 200
    `;
    const [rows] = await pool.query(sql);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("Admin responses error", err);
    res.status(500).json({ ok: false, error: "ADMIN_RESPONSES_ERROR" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Using MySQL at ${dbHost}:${dbPort}, DB: ${dbName}`);
});
