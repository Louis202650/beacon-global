-- 1. Convocatorias / Vacantes
CREATE TABLE IF NOT EXISTS vacantes (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE NOT NULL,
  titulo_puesto VARCHAR(150) NOT NULL,
  unidad_area VARCHAR(120),
  ciudad VARCHAR(80) DEFAULT 'Quito',
  descripcion TEXT,
  estado VARCHAR(20) DEFAULT 'ABIERTA',
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Postulantes (Paso 1: Datos personales y profesionales)
CREATE TABLE IF NOT EXISTS postulantes (
  id SERIAL PRIMARY KEY,
  vacante_id INT REFERENCES vacantes(id) ON DELETE CASCADE,
  nombre_completo VARCHAR(150) NOT NULL,
  cedula VARCHAR(10) NOT NULL,
  correo VARCHAR(120) NOT NULL,
  celular VARCHAR(20) NOT NULL,
  ciudad VARCHAR(80) NOT NULL,
  profesion VARCHAR(120) NOT NULL,
  nota_meritos NUMERIC(5,2) DEFAULT 0,
  nota_tecnica NUMERIC(5,2) DEFAULT 0,
  nota_entrevista NUMERIC(5,2) DEFAULT 0,
  estado_proceso VARCHAR(30) DEFAULT 'POSTULADO',
  observaciones TEXT,
  fecha_postulacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vacante_id, cedula)
);

-- 3. Documentos del Postulante (Paso 2: Múltiples PDFs)
CREATE TABLE IF NOT EXISTS postulante_documentos (
  id SERIAL PRIMARY KEY,
  postulante_id INT REFERENCES postulantes(id) ON DELETE CASCADE,
  tipo_documento VARCHAR(80) DEFAULT 'Hoja de Vida / Respaldo',
  nombre_original VARCHAR(255) NOT NULL,
  ruta_archivo VARCHAR(255) NOT NULL,
  fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Evaluación de Desempeño
CREATE TABLE IF NOT EXISTS evaluaciones_desempeno (
  id SERIAL PRIMARY KEY,
  periodo VARCHAR(50) NOT NULL,
  cedula_evaluado VARCHAR(10) NOT NULL,
  nombre_evaluado VARCHAR(150) NOT NULL,
  cargo VARCHAR(120) NOT NULL,
  unidad VARCHAR(120),
  evaluador VARCHAR(150) NOT NULL,
  puntaje_metas NUMERIC(5,2) DEFAULT 0,
  puntaje_competencias NUMERIC(5,2) DEFAULT 0,
  puntaje_conductual NUMERIC(5,2) DEFAULT 0,
  nota_final NUMERIC(5,2) GENERATED ALWAYS AS (
    ROUND((puntaje_metas * 0.50) + (puntaje_competencias * 0.30) + (puntaje_conductual * 0.20), 2)
  ) STORED,
  observaciones TEXT,
  fecha_evaluacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vacante inicial de muestra
INSERT INTO vacantes (codigo, titulo_puesto, unidad_area, ciudad, descripcion, estado)
VALUES (
  'BG-2026-001',
  'Analista de Talento Humano',
  'Dirección Administrativa y Talento Humano',
  'Quito',
  'Gestión de subsistemas de talento humano, clasificación de puestos y procesos de selección bajo normativa vigente.',
  'ABIERTA'
) ON CONFLICT (codigo) DO NOTHING;
-- ==============================================================================
-- MÓDULO 2.0: EVALUACIONES OPCIONALES (CONFIABILIDAD + 16PF) Y DEBIDA DILIGENCIA
-- ==============================================================================

-- 1. Control de habilitación opcional por candidato (Terna / Opcionados)
CREATE TABLE IF NOT EXISTS habilitacion_tests (
    id SERIAL PRIMARY KEY,
    postulante_id INTEGER UNIQUE REFERENCES postulantes(id) ON DELETE CASCADE,
    token_acceso VARCHAR(64) UNIQUE NOT NULL,
    incluye_confiabilidad BOOLEAN DEFAULT TRUE,
    incluye_16pf BOOLEAN DEFAULT FALSE,
    estado_confiabilidad VARCHAR(20) DEFAULT 'PENDIENTE', -- NO_APLICA, PENDIENTE, COMPLETADO
    estado_16pf VARCHAR(20) DEFAULT 'NO_APLICA',          -- NO_APLICA, PENDIENTE, COMPLETADO
    fecha_habilitacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_completado TIMESTAMP
);

-- 2. Resultados Test de Confiabilidad Laboral (8 Factores)
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

-- 3. Resultados Perfil de Personalidad (16 Factores de Cattell)
CREATE TABLE IF NOT EXISTS resultados_16pf (
    id SERIAL PRIMARY KEY,
    postulante_id INTEGER UNIQUE REFERENCES postulantes(id) ON DELETE CASCADE,
    decatipos_16 JSONB NOT NULL,
    dimensiones_globales JSONB NOT NULL,
    ajuste_perfil NUMERIC(5,2) NOT NULL,
    respuestas_detalle JSONB,
    fecha_evaluacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Verificación de Antecedentes (Penales, Judiciales, Académicos + PDFs)
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
