-- =========================================================================
-- TABLAS DE AUTOMATIZACIÓN DE WHATSAPP PARA EL SISTEMA WISI
-- =========================================================================

-- 1. Tabla para asociar Grupos de WhatsApp con las Salas del Casino
CREATE TABLE IF NOT EXISTS whatsapp_group_mappings (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE,
    group_jid VARCHAR(100) NOT NULL UNIQUE,            -- Identificador único del grupo (ej: 12036302482939@g.us)
    group_name VARCHAR(255),                            -- Nombre identificador del grupo (ej: Caja Central Mesas)
    sala_uuid UUID,                                     -- Sala a la que pertenece el grupo
    multisala_uuid UUID,                                -- Multisala opcional
    modulo_destino VARCHAR(50) DEFAULT 'control_clientes', -- 'control_clientes' o 'aportes_maquinas'
    caja_default VARCHAR(50) DEFAULT 'Mesas',           -- 'Mesas' o 'Máquinas' si no se especifica en el mensaje
    auto_reply BOOLEAN DEFAULT true,                    -- Enviar respuesta de confirmación al grupo
    is_active BOOLEAN DEFAULT true,                     -- Monitoreo activo
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Índices de búsqueda para whatsapp_group_mappings
CREATE INDEX IF NOT EXISTS idx_wa_mappings_jid ON whatsapp_group_mappings(group_jid);
CREATE INDEX IF NOT EXISTS idx_wa_mappings_sala ON whatsapp_group_mappings(sala_uuid);

-- 2. Tabla para registrar los logs y auditoría de todos los mensajes procesados
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE,
    group_jid VARCHAR(100),                             -- JID del grupo donde se envió
    group_name VARCHAR(255),                            -- Nombre del grupo en ese momento
    sender_jid VARCHAR(100),                            -- JID del usuario emisor
    sender_name VARCHAR(255),                           -- Nombre del usuario en WhatsApp
    raw_message TEXT,                                   -- Mensaje original tal como se escribió
    parsed_data JSONB,                                  -- Objeto JSON con los datos extraídos (tipo, monto, cliente/operador, etc.)
    status VARCHAR(50),                                 -- 'procesado', 'sin_libro_activo', 'error_interno'
    error_message TEXT,                                 -- Detalle del error en caso de fallo
    inserted_record_uuid UUID,                          -- UUID del registro creado en libro_control_clientes o libro_aportes
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Índices de búsqueda para whatsapp_logs
CREATE INDEX IF NOT EXISTS idx_wa_logs_created ON whatsapp_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_logs_jid ON whatsapp_logs(group_jid);
CREATE INDEX IF NOT EXISTS idx_wa_logs_status ON whatsapp_logs(status);
