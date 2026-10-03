-- ====================================================================
-- MIGRACIÓN WISI SPACE - MÓDULO CECOM CCTV & IA DE MESAS
-- Tablas 100% compatibles con la convención UUID y soft-delete de Wisi
-- ====================================================================

-- 1. Grabadores y Cámaras (Equipos Físicos en LAN)
CREATE TABLE IF NOT EXISTS dispositivos_camaras (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sala_uuid UUID NOT NULL REFERENCES salas(uuid) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'NVR', -- 'NVR', 'DVR', 'CAMARA_IP'
    ip_local VARCHAR(100) NOT NULL,
    usuario VARCHAR(100) NOT NULL DEFAULT 'admin',
    clave VARCHAR(100) NOT NULL DEFAULT '',
    puerto_sdk INT NOT NULL DEFAULT 8000,
    puerto_http INT NOT NULL DEFAULT 80,
    puerto_rtsp INT NOT NULL DEFAULT 554,
    canales_totales INT NOT NULL DEFAULT 1,
    metadata_canales JSONB DEFAULT '[]',
    active INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispositivos_camaras_sala ON dispositivos_camaras(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_dispositivos_camaras_active ON dispositivos_camaras(active) WHERE is_deleted = false;

-- 2. Canales / Cámaras individuales descubiertas
CREATE TABLE IF NOT EXISTS camaras (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_camara_uuid UUID NOT NULL REFERENCES dispositivos_camaras(uuid) ON DELETE CASCADE,
    sala_uuid UUID NOT NULL REFERENCES salas(uuid) ON DELETE CASCADE,
    numero_canal INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'IP', -- 'IP', 'ANALOGICA'
    ip_origen VARCHAR(100),
    audio_habilitado BOOLEAN DEFAULT false,
    active INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_disp_camara_canal UNIQUE (dispositivo_camara_uuid, numero_canal)
);

CREATE INDEX IF NOT EXISTS idx_camaras_dispositivo ON camaras(dispositivo_camara_uuid);
CREATE INDEX IF NOT EXISTS idx_camaras_sala ON camaras(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_camaras_active ON camaras(active) WHERE is_deleted = false;

-- 3. Asociación Mesa <-> Cámaras (Para la IA de Mesas)
CREATE TABLE IF NOT EXISTS mesas_camaras (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mesa_uuid UUID NOT NULL REFERENCES mesas(uuid) ON DELETE CASCADE,
    camara_uuid UUID NOT NULL REFERENCES camaras(uuid) ON DELETE CASCADE,
    rol VARCHAR(50) NOT NULL DEFAULT 'CENITAL_CARTAS', -- 'CENITAL_CARTAS', 'PANO_DOLLY', 'FRONTAL_DEALER', 'BUZON_DROP'
    active INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_mesa_camara UNIQUE (mesa_uuid, camara_uuid)
);

CREATE INDEX IF NOT EXISTS idx_mesas_camaras_mesa ON mesas_camaras(mesa_uuid);
CREATE INDEX IF NOT EXISTS idx_mesas_camaras_camara ON mesas_camaras(camara_uuid);

-- 4. Registro de Eventos e Incidencias en Vivo de IA (Tiempo Real y Novedades)
CREATE TABLE IF NOT EXISTS cecom_ia_eventos (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sala_uuid UUID NOT NULL REFERENCES salas(uuid) ON DELETE CASCADE,
    mesa_uuid UUID NOT NULL REFERENCES mesas(uuid) ON DELETE CASCADE,
    camara_uuid UUID REFERENCES camaras(uuid) ON DELETE SET NULL,
    juego_nombre VARCHAR(100),
    tipo_evento VARCHAR(50) NOT NULL, -- 'JUGADA', 'DROP', 'MALDON', 'CAMBIO_BARAJO', 'ANOMALIA'
    descripcion TEXT NOT NULL,
    foto TEXT DEFAULT NULL,
    metadata JSONB DEFAULT '{}',
    es_novedad BOOLEAN NOT NULL DEFAULT false,
    nivel_alerta VARCHAR(20) NOT NULL DEFAULT 'INFO', -- 'INFO', 'WARN', 'CRITICAL'
    atendido BOOLEAN NOT NULL DEFAULT false,
    atendido_por VARCHAR(150),
    active INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cecom_ia_eventos_sala ON cecom_ia_eventos(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_eventos_mesa ON cecom_ia_eventos(mesa_uuid);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_eventos_tipo ON cecom_ia_eventos(tipo_evento);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_eventos_novedad ON cecom_ia_eventos(es_novedad) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_cecom_ia_eventos_created ON cecom_ia_eventos(created_at DESC);
ALTER TABLE cecom_ia_eventos ADD COLUMN IF NOT EXISTS foto TEXT DEFAULT NULL;

-- 5. Registro Histórico de Jugadas en Tiempo Real (IA Tiempo Real)
CREATE TABLE IF NOT EXISTS cecom_ia_jugadas (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sala_uuid UUID NOT NULL REFERENCES salas(uuid) ON DELETE CASCADE,
    mesa_uuid UUID NOT NULL REFERENCES mesas(uuid) ON DELETE CASCADE,
    camara_uuid UUID REFERENCES camaras(uuid) ON DELETE SET NULL,
    juego_nombre VARCHAR(100) NOT NULL, -- 'BACCARAT', 'BLACKJACK', 'RULETA', 'POKER_CARIBENO', 'TEXAS_BONUS'
    numero_ronda INT,
    cartas_jugador JSONB DEFAULT '[]',
    cartas_dealer JSONB DEFAULT '[]',
    cartas_comunitarias JSONB DEFAULT '[]',
    puntuacion_jugador INT,
    puntuacion_dealer INT,
    numero_ruleta INT,
    color_ruleta VARCHAR(20),
    resultado_oficial VARCHAR(150) NOT NULL,
    reglas_validadas BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}',
    active INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cecom_ia_jugadas_sala ON cecom_ia_jugadas(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_jugadas_mesa ON cecom_ia_jugadas(mesa_uuid);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_jugadas_juego ON cecom_ia_jugadas(juego_nombre);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_jugadas_created ON cecom_ia_jugadas(created_at DESC);

-- 6. Registro de Novedades e Incidencias (IA Novedades)
CREATE TABLE IF NOT EXISTS cecom_ia_novedades (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sala_uuid UUID NOT NULL REFERENCES salas(uuid) ON DELETE CASCADE,
    mesa_uuid UUID NOT NULL REFERENCES mesas(uuid) ON DELETE CASCADE,
    camara_uuid UUID REFERENCES camaras(uuid) ON DELETE SET NULL,
    jugada_uuid UUID REFERENCES cecom_ia_jugadas(uuid) ON DELETE SET NULL,
    juego_nombre VARCHAR(100),
    tipo_novedad VARCHAR(50) NOT NULL, -- 'DROP', 'MALDON', 'CAMBIO_BARAJO', 'APUESTA_TARDIA', 'ANOMALIA'
    severidad VARCHAR(20) NOT NULL DEFAULT 'INFO', -- 'INFO', 'WARN', 'CRITICAL'
    descripcion TEXT NOT NULL,
    evidencia_metadata JSONB DEFAULT '{}',
    atendido BOOLEAN NOT NULL DEFAULT false,
    atendido_por VARCHAR(150),
    atendido_at TIMESTAMP WITH TIME ZONE,
    notas_resolucion TEXT,
    active INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cecom_ia_novedades_sala ON cecom_ia_novedades(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_novedades_mesa ON cecom_ia_novedades(mesa_uuid);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_novedades_tipo ON cecom_ia_novedades(tipo_novedad);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_novedades_atendido ON cecom_ia_novedades(atendido);
CREATE INDEX IF NOT EXISTS idx_cecom_ia_novedades_created ON cecom_ia_novedades(created_at DESC);


