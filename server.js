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
const crypto = require('crypto');

// Asegurar creación automática de tablas v2.0 al iniciar en Render
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS habilitacion_tests (
                id SERIAL PRIMARY KEY,
                postulante_id INTEGER UNIQUE REFERENCES postulantes(id) ON DELETE CASCADE,
                token_acceso VARCHAR(64) UNIQUE NOT NULL,
                incluye_confiabilidad BOOLEAN DEFAULT TRUE,
                incluye_16pf BOOLEAN DEFAULT FALSE,
                estado_confiabilidad VARCHAR(20) DEFAULT 'PENDIENTE',
                estado_16pf VARCHAR(20) DEFAULT 'NO_APLICA',
                fecha_habilitacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_completado TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS resultados_confiabilidad (
                id SERIAL PRIMARY KEY,
                postulante_id INTEGER UNIQUE REFERENCES postulantes(id) ON DELETE CASCADE,
                puntaje_integridad NUMERIC(5,2) NOT NULL,
                puntaje_robo NUMERIC(5,2) NOT NULL,
                puntaje_mentira NUMERIC(5,2) NOT NULL,
                puntaje_alcohol_drogas NUMERIC(5,2) NOT NULL,
                puntaje_mobbing NUMERIC(5,2) NOT NULL,
                puntaje_violencia NUMERIC(5,2) NOT NULL,
                puntaje_riesgo_informatico NUMERIC(5,2) NOT NULL,
                puntaje_acoso_sexual NUMERIC(5,2) NOT NULL,
                indice_global NUMERIC(5,2) NOT NULL,
                nivel_riesgo VARCHAR(20) NOT NULL,
                respuestas_detalle JSONB,
                fecha_evaluacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS resultados_16pf (
                id SERIAL PRIMARY KEY,
                postulante_id INTEGER UNIQUE REFERENCES postulantes(id) ON DELETE CASCADE,
                decatipos_16 JSONB NOT NULL,
                dimensiones_globales JSONB NOT NULL,
                ajuste_perfil NUMERIC(5,2) NOT NULL,
                respuestas_detalle JSONB,
                fecha_evaluacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS verificacion_antecedentes (
                id SERIAL PRIMARY KEY,
                postulante_id INTEGER UNIQUE REFERENCES postulantes(id) ON DELETE CASCADE,
                estado_penales VARCHAR(30) DEFAULT 'PENDIENTE',
                estado_judiciales VARCHAR(30) DEFAULT 'PENDIENTE',
                estado_academicos VARCHAR(30) DEFAULT 'PENDIENTE',
                observaciones TEXT,
                pdf_penales_nombre VARCHAR(255),
                pdf_penales_data BYTEA,
                pdf_judiciales_nombre VARCHAR(255),
                pdf_judiciales_data BYTEA,
                pdf_academicos_nombre VARCHAR(255),
                pdf_academicos_data BYTEA,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Tablas v2.0 (Confiabilidad, 16PF y Antecedentes) verificadas');
    } catch (err) {
        console.error('Error inicializando tablas v2.0:', err);
    }
})();

// 1. Habilitar evaluaciones opcionales para un candidato
app.post('/api/admin/habilitar-test', async (req, res) => {
    const { postulante_id, incluye_confiabilidad, incluye_16pf } = req.body;
    try {
        const token = crypto.randomBytes(20).toString('hex');
        const estConf = incluye_confiabilidad ? 'PENDIENTE' : 'NO_APLICA';
        const est16 = incluye_16pf ? 'PENDIENTE' : 'NO_APLICA';

        const result = await pool.query(`
            INSERT INTO habilitacion_tests (postulante_id, token_acceso, incluye_confiabilidad, incluye_16pf, estado_confiabilidad, estado_16pf)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (postulante_id) DO UPDATE SET
                incluye_confiabilidad = EXCLUDED.incluye_confiabilidad,
                incluye_16pf = EXCLUDED.incluye_16pf,
                estado_confiabilidad = CASE WHEN habilitacion_tests.estado_confiabilidad = 'COMPLETADO' THEN 'COMPLETADO' ELSE EXCLUDED.estado_confiabilidad END,
                estado_16pf = CASE WHEN habilitacion_tests.estado_16pf = 'COMPLETADO' THEN 'COMPLETADO' ELSE EXCLUDED.estado_16pf END
            RETURNING token_acceso
        `, [postulante_id, token, !!incluye_confiabilidad, !!incluye_16pf, estConf, est16]);

        res.json({ ok: true, token: result.rows[0].token_acceso });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Validar token del candidato al abrir el portal de evaluación
app.get('/api/evaluacion/:token', async (req, res) => {
    try {
        const q = await pool.query(`
            SELECT h.*, p.nombres, p.apellidos, p.cedula, p.cargo_postulado
            FROM habilitacion_tests h
            JOIN postulantes p ON p.id = h.postulante_id
            WHERE h.token_acceso = $1
        `, [req.params.token]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Enlace inválido o no autorizado.' });
        res.json(q.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Guardar resultados de Confiabilidad (8 Factores) y/o 16PF y sincronizar nota T
app.post('/api/evaluacion/:token/guardar', async (req, res) => {
    const { confiabilidad, personalidad16 } = req.body;
    try {
        const q = await pool.query('SELECT * FROM habilitacion_tests WHERE token_acceso = $1', [req.params.token]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Token inválido' });
        const hab = q.rows[0];
        let notasT = [];

        if (confiabilidad) {
            await pool.query(`
                INSERT INTO resultados_confiabilidad (
                    postulante_id, puntaje_integridad, puntaje_robo, puntaje_mentira,
                    puntaje_alcohol_drogas, puntaje_mobbing, puntaje_violencia,
                    puntaje_riesgo_informatico, puntaje_acoso_sexual, indice_global, nivel_riesgo, respuestas_detalle
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (postulante_id) DO UPDATE SET
                    puntaje_integridad = EXCLUDED.puntaje_integridad,
                    puntaje_robo = EXCLUDED.puntaje_robo,
                    puntaje_mentira = EXCLUDED.puntaje_mentira,
                    puntaje_alcohol_drogas = EXCLUDED.puntaje_alcohol_drogas,
                    puntaje_mobbing = EXCLUDED.puntaje_mobbing,
                    puntaje_violencia = EXCLUDED.puntaje_violencia,
                    puntaje_riesgo_informatico = EXCLUDED.puntaje_riesgo_informatico,
                    puntaje_acoso_sexual = EXCLUDED.puntaje_acoso_sexual,
                    indice_global = EXCLUDED.indice_global,
                    nivel_riesgo = EXCLUDED.nivel_riesgo,
                    respuestas_detalle = EXCLUDED.respuestas_detalle,
                    fecha_evaluacion = CURRENT_TIMESTAMP
            `, [
                hab.postulante_id, confiabilidad.integridad, confiabilidad.robo, confiabilidad.mentira,
                confiabilidad.alcohol_drogas, confiabilidad.mobbing, confiabilidad.violencia,
                confiabilidad.riesgo_informatico, confiabilidad.acoso_sexual,
                confiabilidad.indice_global, confiabilidad.nivel_riesgo, JSON.stringify(confiabilidad.detalle || {})
            ]);
            await pool.query("UPDATE habilitacion_tests SET estado_confiabilidad = 'COMPLETADO', fecha_completado = CURRENT_TIMESTAMP WHERE id = $1", [hab.id]);
            notasT.push(Number(confiabilidad.indice_global) / 10); // Escala 0-10
        }

        if (personalidad16) {
            await pool.query(`
                INSERT INTO resultados_16pf (postulante_id, decatipos_16, dimensiones_globales, ajuste_perfil, respuestas_detalle)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (postulante_id) DO UPDATE SET
                    decatipos_16 = EXCLUDED.decatipos_16,
                    dimensiones_globales = EXCLUDED.dimensiones_globales,
                    ajuste_perfil = EXCLUDED.ajuste_perfil,
                    respuestas_detalle = EXCLUDED.respuestas_detalle,
                    fecha_evaluacion = CURRENT_TIMESTAMP
            `, [
                hab.postulante_id, JSON.stringify(personalidad16.decatipos),
                JSON.stringify(personalidad16.dimensiones), personalidad16.ajuste_perfil,
                JSON.stringify(personalidad16.detalle || {})
            ]);
            await pool.query("UPDATE habilitacion_tests SET estado_16pf = 'COMPLETADO', fecha_completado = CURRENT_TIMESTAMP WHERE id = $1", [hab.id]);
            notasT.push(Number(personalidad16.ajuste_perfil) / 10); // Escala 0-10
        }

        // Sincronizar automáticamente la casilla T (Tests) en postulantes
        if (notasT.length > 0) {
            const promedioT = (notasT.reduce((a, b) => a + b, 0) / notasT.length).toFixed(1);
            await pool.query('UPDATE postulantes SET nota_test = $1 WHERE id = $2', [promedioT, hab.postulante_id]);
        }

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Listar resumen completo de evaluaciones y antecedentes para el Admin
app.get('/api/admin/evaluaciones-resumen', async (req, res) => {
    try {
        const q = await pool.query(`
            SELECT p.id, p.nombres, p.apellidos, p.cedula, p.cargo_postulado,
                   h.token_acceso, h.incluye_confiabilidad, h.incluye_16pf, h.estado_confiabilidad, h.estado_16pf,
                   rc.indice_global, rc.nivel_riesgo, rc.puntaje_integridad, rc.puntaje_robo, rc.puntaje_mentira,
                   rc.puntaje_alcohol_drogas, rc.puntaje_mobbing, rc.puntaje_violencia, rc.puntaje_riesgo_informatico, rc.puntaje_acoso_sexual,
                   r16.decatipos_16, r16.dimensiones_globales, r16.ajuste_perfil,
                   va.estado_penales, va.estado_judiciales, va.estado_academicos, va.observaciones,
                   va.pdf_penales_nombre, va.pdf_judiciales_nombre, va.pdf_academicos_nombre
            FROM postulantes p
            LEFT JOIN habilitacion_tests h ON h.postulante_id = p.id
            LEFT JOIN resultados_confiabilidad rc ON rc.postulante_id = p.id
            LEFT JOIN resultados_16pf r16 ON r16.postulante_id = p.id
            LEFT JOIN verificacion_antecedentes va ON va.postulante_id = p.id
            ORDER BY p.id DESC
        `);
        res.json(q.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Guardar estados y PDFs de Antecedentes (Penales, Judiciales, Académicos)
app.post('/api/admin/antecedentes/:id', upload.fields([
    { name: 'pdf_penales', maxCount: 1 },
    { name: 'pdf_judiciales', maxCount: 1 },
    { name: 'pdf_academicos', maxCount: 1 }
]), async (req, res) => {
    const postulanteId = req.params.id;
    const { estado_penales, estado_judiciales, estado_academicos, observaciones } = req.body;
    const files = req.files || {};

    try {
        await pool.query(`
            INSERT INTO verificacion_antecedentes (postulante_id, estado_penales, estado_judiciales, estado_academicos, observaciones)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (postulante_id) DO UPDATE SET
                estado_penales = EXCLUDED.estado_penales,
                estado_judiciales = EXCLUDED.estado_judiciales,
                estado_academicos = EXCLUDED.estado_academicos,
                observaciones = EXCLUDED.observaciones,
                fecha_actualizacion = CURRENT_TIMESTAMP
        `, [postulanteId, estado_penales || 'PENDIENTE', estado_judiciales || 'PENDIENTE', estado_academicos || 'PENDIENTE', observaciones || '']);

        if (files.pdf_penales?.[0]) {
            await pool.query('UPDATE verificacion_antecedentes SET pdf_penales_nombre=$1, pdf_penales_data=$2 WHERE postulante_id=$3',
                [files.pdf_penales[0].originalname, files.pdf_penales[0].buffer, postulanteId]);
        }
        if (files.pdf_judiciales?.[0]) {
            await pool.query('UPDATE verificacion_antecedentes SET pdf_judiciales_nombre=$1, pdf_judiciales_data=$2 WHERE postulante_id=$3',
                [files.pdf_judiciales[0].originalname, files.pdf_judiciales[0].buffer, postulanteId]);
        }
        if (files.pdf_academicos?.[0]) {
            await pool.query('UPDATE verificacion_antecedentes SET pdf_academicos_nombre=$1, pdf_academicos_data=$2 WHERE postulante_id=$3',
                [files.pdf_academicos[0].originalname, files.pdf_academicos[0].buffer, postulanteId]);
        }

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Descargar/ver PDF de Antecedentes guardado en PostgreSQL
app.get('/api/admin/antecedentes/:id/pdf/:tipo', async (req, res) => {
    const { id, tipo } = req.params;
    const mapa = {
        penales: ['pdf_penales_nombre', 'pdf_penales_data'],
        judiciales: ['pdf_judiciales_nombre', 'pdf_judiciales_data'],
        academicos: ['pdf_academicos_nombre', 'pdf_academicos_data']
    };
    if (!mapa[tipo]) return res.status(400).send('Tipo inválido');

    try {
        const q = await pool.query(`SELECT ${mapa[tipo][0]} AS nombre, ${mapa[tipo][1]} AS data FROM verificacion_antecedentes WHERE postulante_id = $1`, [id]);
        if (!q.rows.length || !q.rows[0].data) return res.status(404).send('Documento no encontrado');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${q.rows[0].nombre}"`);
        res.send(q.rows[0].data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});
app.listen(PORT, () => {
  console.log(`🚀 Beacon Global activo en http://localhost:${PORT}`);
});
