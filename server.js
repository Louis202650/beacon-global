require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads', 'cv');
fs.mkdirSync(uploadDir, { recursive: true });

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      }
    : {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        port: Number(process.env.DB_PORT) || 5432
      }
);

const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
pool.query(initSql)
  .then(() => console.log('✓ Base de datos Beacon Global sincronizada correctamente'))
  .catch(err => console.error('Error inicializando BD:', err.message));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `postulante_${req.params.id}_${unique}.pdf`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se permiten archivos en formato PDF.'));
  }
});

function verificarAdmin(req, res, next) {
  const pass = req.headers['x-admin-pass'];
  if (!pass || pass !== (process.env.ADMIN_PASS || 'Beacon2026*')) {
    return res.status(401).json({ exito: false, error: 'Acceso no autorizado. Clave incorrecta.' });
  }
  next();
}

// --- RUTAS PÚBLICAS ---
app.get('/api/vacantes-abiertas', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, codigo, titulo_puesto, unidad_area, ciudad, descripcion FROM vacantes WHERE estado = 'ABIERTA' ORDER BY fecha_creacion DESC"
    );
    res.json({ exito: true, vacantes: result.rows });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.post('/api/postulaciones/paso1', async (req, res) => {
  try {
    const { vacante_id, nombre_completo, cedula, correo, celular, ciudad, profesion } = req.body;
    if (!vacante_id || !nombre_completo || !cedula || !correo || !celular || !ciudad || !profesion) {
      return res.status(400).json({ exito: false, error: 'Todos los campos son obligatorios.' });
    }
    if (!/^\d{10}$/.test(cedula.trim())) {
      return res.status(400).json({ exito: false, error: 'La cédula debe contener 10 dígitos numéricos.' });
    }

    const result = await pool.query(
      `INSERT INTO postulantes (vacante_id, nombre_completo, cedula, correo, celular, ciudad, profesion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (vacante_id, cedula) DO UPDATE SET
         nombre_completo = EXCLUDED.nombre_completo,
         correo = EXCLUDED.correo,
         celular = EXCLUDED.celular,
         ciudad = EXCLUDED.ciudad,
         profesion = EXCLUDED.profesion
       RETURNING id, cedula, nombre_completo`,
      [vacante_id, nombre_completo.trim(), cedula.trim(), correo.trim(), celular.trim(), ciudad.trim(), profesion.trim()]
    );

    res.json({
      exito: true,
      postulanteId: result.rows[0].id,
      mensaje: 'Datos personales guardados. Suba ahora su Hoja de Vida y respaldos en PDF.'
    });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.post('/api/postulaciones/paso2/:id', upload.array('documentos', 5), async (req, res) => {
  try {
    const postulanteId = req.params.id;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ exito: false, error: 'Debe adjuntar al menos un archivo PDF.' });
    }

    const guardados = [];
    for (const file of req.files) {
      const rutaPublica = `/uploads/cv/${file.filename}`;
      const doc = await pool.query(
        `INSERT INTO postulante_documentos (postulante_id, nombre_original, ruta_archivo)
         VALUES ($1, $2, $3) RETURNING id, nombre_original, ruta_archivo`,
        [postulanteId, file.originalname, rutaPublica]
      );
      guardados.push(doc.rows[0]);
    }

    res.json({
      exito: true,
      totalArchivos: guardados.length,
      documentos: guardados,
      mensaje: `Postulación completada con éxito (${guardados.length} documento(s) cargado(s)).`
    });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

// --- RUTAS ADMINISTRATIVAS ---
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASS || 'Beacon2026*')) return res.json({ exito: true });
  res.status(401).json({ exito: false, error: 'Contraseña incorrecta.' });
});

app.post('/api/admin/vacantes', verificarAdmin, async (req, res) => {
  try {
    const { codigo, titulo_puesto, unidad_area, ciudad, descripcion } = req.body;
    const result = await pool.query(
      `INSERT INTO vacantes (codigo, titulo_puesto, unidad_area, ciudad, descripcion)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [codigo.trim(), titulo_puesto.trim(), unidad_area, ciudad || 'Quito', descripcion]
    );
    res.json({ exito: true, vacante: result.rows[0] });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.get('/api/admin/vacantes', verificarAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vacantes ORDER BY fecha_creacion DESC');
    res.json({ exito: true, vacantes: result.rows });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.get('/api/admin/postulantes', verificarAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, v.titulo_puesto, v.codigo AS codigo_vacante,
        COALESCE(
          json_agg(
            json_build_object('id', d.id, 'nombre', d.nombre_original, 'url', d.ruta_archivo)
          ) FILTER (WHERE d.id IS NOT NULL), '[]'
        ) AS documentos
      FROM postulantes p
      JOIN vacantes v ON p.vacante_id = v.id
      LEFT JOIN postulante_documentos d ON d.postulante_id = p.id
      GROUP BY p.id, v.titulo_puesto, v.codigo
      ORDER BY p.fecha_postulacion DESC
    `);
    res.json({ exito: true, postulantes: result.rows });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.put('/api/admin/postulantes/:id/calificar', verificarAdmin, async (req, res) => {
  try {
    const { nota_meritos, nota_tecnica, nota_entrevista, estado_proceso, observaciones } = req.body;
    await pool.query(
      `UPDATE postulantes
       SET nota_meritos = $1, nota_tecnica = $2, nota_entrevista = $3, estado_proceso = $4, observaciones = $5
       WHERE id = $6`,
      [nota_meritos || 0, nota_tecnica || 0, nota_entrevista || 0, estado_proceso || 'EVALUADO', observaciones || '', req.params.id]
    );
    res.json({ exito: true });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.post('/api/admin/evaluaciones', verificarAdmin, async (req, res) => {
  try {
    const { periodo, cedula_evaluado, nombre_evaluado, cargo, unidad, evaluador, puntaje_metas, puntaje_competencias, puntaje_conductual, observaciones } = req.body;
    const result = await pool.query(
      `INSERT INTO evaluaciones_desempeno
       (periodo, cedula_evaluado, nombre_evaluado, cargo, unidad, evaluador, puntaje_metas, puntaje_competencias, puntaje_conductual, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [periodo, cedula_evaluado, nombre_evaluado, cargo, unidad, evaluador, puntaje_metas || 0, puntaje_competencias || 0, puntaje_conductual || 0, observaciones || '']
    );
    res.json({ exito: true, evaluacion: result.rows[0] });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.get('/api/admin/evaluaciones', verificarAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM evaluaciones_desempeno ORDER BY fecha_evaluacion DESC');
    res.json({ exito: true, evaluaciones: result.rows });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Beacon Global activo en http://localhost:${PORT}`);
});
