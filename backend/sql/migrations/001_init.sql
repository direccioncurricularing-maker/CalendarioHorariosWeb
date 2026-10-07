-- ============================================================================
-- SCHEMA DE BASE DE DATOS - SISTEMA DE GESTIÓN DE HORARIOS DE CARRERA
-- ============================================================================

-- TABLA 1: USUARIOS
-- Almacena los usuarios del sistema (coordinadores, administradores, etc.)
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    mail VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLA 2: DASHBOARDS
-- Almacena los dashboards de cada usuario para gestionar sus horarios
CREATE TABLE IF NOT EXISTS dashboards (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    usuario_id INTEGER NOT NULL,
    -- Rango de fechas del calendario asociado al dashboard
    fecha_inicio DATE,
    fecha_fin DATE,
    -- Lista de fechas marcadas como feriado (formato JSON array: ["2026-03-01", ...])
    feriados JSON DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dashboard_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- TABLA 3: SALAS
-- Tabla de normalización para salas
CREATE TABLE IF NOT EXISTS salas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    capacidad INTEGER,
    es_especial BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLA 4: PROFESORES
-- Almacena los profesores y sus disponibilidades
CREATE TABLE IF NOT EXISTS profesores (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(255),
    disponibilidades JSON DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLA 5: HORAS_PROGRAMABLES
-- Template/Plantilla de horas que pueden ser programadas
-- especialidades_semestres: JSON array con [{nombre: string, semestre: integer}, ...]
-- disponibilidad: JSON con disponibilidad horaria del profesor por día
--   Formato: { "Lunes": ["9:30-10:20", "10:30-11:20"], "Martes": [...], ... }
CREATE TABLE IF NOT EXISTS horas_programables (

    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL,
    seccion VARCHAR(50) NOT NULL,
    tipo_hora VARCHAR(100) NOT NULL,
    titulo VARCHAR(255),
    cantidad_horas INTEGER NOT NULL,
    profesor_1_id INTEGER,
    profesor_2_id INTEGER,
    especialidades_semestres JSON DEFAULT '[]',
    disponibilidad JSON DEFAULT '{}',
    sala_id INTEGER,
    sala_especial VARCHAR(255),
    distribucion_horario VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_horas_prog_codigo_seccion_tipo UNIQUE (codigo, seccion, tipo_hora),
    CONSTRAINT fk_horas_prog_prof1 FOREIGN KEY (profesor_1_id) REFERENCES profesores(id) ON DELETE SET NULL,
    CONSTRAINT fk_horas_prog_prof2 FOREIGN KEY (profesor_2_id) REFERENCES profesores(id) ON DELETE SET NULL,
    CONSTRAINT fk_horas_prog_sala FOREIGN KEY (sala_id) REFERENCES salas(id) ON DELETE SET NULL
);

-- TABLA 6: HORAS_REGISTRADAS
-- Registro de horas efectivamente programadas/asignadas
CREATE TABLE IF NOT EXISTS horas_registradas (
    id SERIAL PRIMARY KEY,
    hora_programable_id INTEGER NOT NULL,
    dashboard_id INTEGER NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    dia_semana VARCHAR(20) NOT NULL,
    horario VARCHAR(50) DEFAULT 'plan_comun',
    conflictos JSON DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_horas_reg_prog FOREIGN KEY (hora_programable_id) REFERENCES horas_programables(id) ON DELETE CASCADE,
    CONSTRAINT fk_horas_reg_dashboard FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

-- TABLA 7: PRUEBAS_PROGRAMABLES
-- Template/Plantilla de pruebas que pueden ser programadas
-- Tipos: CLASE, LAB/TALLER, AYUDANTIA, EXAMEN, TARDE
-- especialidades_semestres: JSON array con [{nombre: string, semestre: integer}, ...]
CREATE TABLE IF NOT EXISTS pruebas_programables (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL,
    seccion VARCHAR(50) NOT NULL,
    tipo_prueba VARCHAR(100) NOT NULL,
    titulo VARCHAR(255),
    profesor_1_id INTEGER,
    profesor_2_id INTEGER,
    especialidades_semestres JSON DEFAULT '[]',
    bloques_horario JSON DEFAULT '[]',
    -- Control de exámenes: indica si el curso tiene examen
    tiene_examen BOOLEAN DEFAULT TRUE,
    -- Cantidad máxima de evaluaciones semestrales (no incluye examen)
    cantidad_evaluaciones INTEGER,
    sala_id INTEGER,
    sala_especial VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_pruebas_prog_codigo_seccion_tipo UNIQUE (codigo, seccion, tipo_prueba),
    CONSTRAINT fk_pruebas_prog_prof1 FOREIGN KEY (profesor_1_id) REFERENCES profesores(id) ON DELETE SET NULL,
    CONSTRAINT fk_pruebas_prog_prof2 FOREIGN KEY (profesor_2_id) REFERENCES profesores(id) ON DELETE SET NULL,
    CONSTRAINT fk_pruebas_prog_sala FOREIGN KEY (sala_id) REFERENCES salas(id) ON DELETE SET NULL
);

-- TABLA 8: PRUEBAS_REGISTRADAS
-- Registro de pruebas efectivamente programadas/asignadas
-- hora_inicio/hora_fin: horario del bloque seleccionado (depende del tipo_prueba)
CREATE TABLE IF NOT EXISTS pruebas_registradas (
    id SERIAL PRIMARY KEY,
    prueba_programable_id INTEGER NOT NULL,
    dashboard_id INTEGER NOT NULL,
    fecha DATE NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    conflictos JSON DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pruebas_reg_prog FOREIGN KEY (prueba_programable_id) REFERENCES pruebas_programables(id) ON DELETE CASCADE,
    CONSTRAINT fk_pruebas_reg_dashboard FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

-- ============================================================================
-- ÍNDICES PARA OPTIMIZAR QUERIES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_dashboards_usuario_id ON dashboards(usuario_id);
CREATE INDEX IF NOT EXISTS idx_horas_registradas_hora_prog ON horas_registradas(hora_programable_id);
CREATE INDEX IF NOT EXISTS idx_horas_registradas_dashboard ON horas_registradas(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_horas_programables_profesor1 ON horas_programables(profesor_1_id);
CREATE INDEX IF NOT EXISTS idx_horas_programables_profesor2 ON horas_programables(profesor_2_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_registradas_prueba_prog ON pruebas_registradas(prueba_programable_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_registradas_dashboard ON pruebas_registradas(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_programables_profesor1 ON pruebas_programables(profesor_1_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_programables_profesor2 ON pruebas_programables(profesor_2_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_mail ON usuarios(mail);

-- ============================================================================
-- MIGRACIONES (ALTER TABLE para tablas existentes)
-- ============================================================================

-- Agregar columna disponibilidad a horas_programables si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN password_hash VARCHAR(255);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM usuarios WHERE password_hash IS NULL OR password_hash = ''
  ) THEN
    ALTER TABLE usuarios
    ALTER COLUMN password_hash SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'horas_programables' AND column_name = 'disponibilidad'
  ) THEN
    ALTER TABLE horas_programables ADD COLUMN disponibilidad JSON DEFAULT '{}';
  END IF;
END $$;

-- Agregar columna bloques_horario a pruebas_programables si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pruebas_programables' AND column_name = 'bloques_horario'
  ) THEN
    ALTER TABLE pruebas_programables ADD COLUMN bloques_horario JSON DEFAULT '[]';
  END IF;
END $$;

-- Agregar columnas hora_inicio y hora_fin a pruebas_registradas si no existen
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pruebas_registradas' AND column_name = 'hora_inicio'
  ) THEN
    ALTER TABLE pruebas_registradas ADD COLUMN hora_inicio TIME;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pruebas_registradas' AND column_name = 'hora_fin'
  ) THEN
    ALTER TABLE pruebas_registradas ADD COLUMN hora_fin TIME;
  END IF;
END $$;

-- Agregar columna feriados a dashboards si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dashboards' AND column_name = 'feriados'
  ) THEN
    ALTER TABLE dashboards ADD COLUMN feriados JSON DEFAULT '[]';
  END IF;
END $$;

-- Agregar columnas tiene_examen y cantidad_evaluaciones a pruebas_programables si no existen
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pruebas_programables' AND column_name = 'tiene_examen'
  ) THEN
    ALTER TABLE pruebas_programables ADD COLUMN tiene_examen BOOLEAN DEFAULT TRUE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pruebas_programables' AND column_name = 'cantidad_evaluaciones'
  ) THEN
    ALTER TABLE pruebas_programables ADD COLUMN cantidad_evaluaciones INTEGER;
  END IF;
END $$;

-- Agregar columna sala_especial a horas_programables si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'horas_programables' AND column_name = 'sala_especial'
  ) THEN
    ALTER TABLE horas_programables ADD COLUMN sala_especial VARCHAR(255);
  END IF;
END $$;

-- Agregar columna distribucion_horario a horas_programables si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'horas_programables' AND column_name = 'distribucion_horario'
  ) THEN
    ALTER TABLE horas_programables ADD COLUMN distribucion_horario VARCHAR(255);
  END IF;
END $$;

-- Agregar columna sala_especial a pruebas_programables si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pruebas_programables' AND column_name = 'sala_especial'
  ) THEN
    ALTER TABLE pruebas_programables ADD COLUMN sala_especial VARCHAR(255);
  END IF;
END $$;
