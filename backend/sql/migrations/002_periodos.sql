-- ============================================================================
-- PERÍODOS DEL MAESTRO
-- Cada dashboard, curso y prueba queda etiquetado con el período del maestro
-- con el que fue creado. Así un maestro nuevo no pisa los dashboards antiguos.
-- ============================================================================

-- Agregar columnas periodo/vigente si no existen (bases existentes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboards' AND column_name = 'periodo'
  ) THEN
    ALTER TABLE dashboards ADD COLUMN periodo VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'horas_programables' AND column_name = 'periodo'
  ) THEN
    ALTER TABLE horas_programables ADD COLUMN periodo VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'horas_programables' AND column_name = 'vigente'
  ) THEN
    ALTER TABLE horas_programables ADD COLUMN vigente BOOLEAN DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pruebas_programables' AND column_name = 'periodo'
  ) THEN
    ALTER TABLE pruebas_programables ADD COLUMN periodo VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pruebas_programables' AND column_name = 'vigente'
  ) THEN
    ALTER TABLE pruebas_programables ADD COLUMN vigente BOOLEAN DEFAULT TRUE;
  END IF;
END $$;

-- Todo lo existente queda como período "anterior"
UPDATE dashboards SET periodo = 'anterior' WHERE periodo IS NULL;
UPDATE horas_programables SET periodo = 'anterior' WHERE periodo IS NULL;
UPDATE pruebas_programables SET periodo = 'anterior' WHERE periodo IS NULL;
UPDATE horas_programables SET vigente = TRUE WHERE vigente IS NULL;
UPDATE pruebas_programables SET vigente = TRUE WHERE vigente IS NULL;

ALTER TABLE dashboards ALTER COLUMN periodo SET NOT NULL;
ALTER TABLE horas_programables ALTER COLUMN periodo SET NOT NULL;
ALTER TABLE pruebas_programables ALTER COLUMN periodo SET NOT NULL;
ALTER TABLE horas_programables ALTER COLUMN vigente SET DEFAULT TRUE;
ALTER TABLE pruebas_programables ALTER COLUMN vigente SET DEFAULT TRUE;

-- Reemplazar claves únicas para incluir el período
ALTER TABLE horas_programables DROP CONSTRAINT IF EXISTS uk_horas_prog_codigo_seccion_tipo;
ALTER TABLE pruebas_programables DROP CONSTRAINT IF EXISTS uk_pruebas_prog_codigo_seccion_tipo;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_horas_prog_periodo_tipo'
  ) THEN
    ALTER TABLE horas_programables
      ADD CONSTRAINT uk_horas_prog_periodo_tipo UNIQUE (periodo, codigo, seccion, tipo_hora);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_pruebas_prog_periodo_tipo'
  ) THEN
    ALTER TABLE pruebas_programables
      ADD CONSTRAINT uk_pruebas_prog_periodo_tipo UNIQUE (periodo, codigo, seccion, tipo_prueba);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dashboards_periodo ON dashboards(periodo);
CREATE INDEX IF NOT EXISTS idx_horas_programables_periodo ON horas_programables(periodo);
CREATE INDEX IF NOT EXISTS idx_pruebas_programables_periodo ON pruebas_programables(periodo);
