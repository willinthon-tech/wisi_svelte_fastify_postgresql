-- =========================================================================
-- TABLAS DE AUTOMATIZACIÓN DE WHATSAPP PARA EL SISTEMA WISI (SCHEMA PUBLIC)
-- =========================================================================

-- Asegurar extensión para gen_random_uuid si no existe
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabla para asociar Grupos de WhatsApp con las Salas del Casino
CREATE TABLE IF NOT EXISTS public.whatsapp_group_mappings (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT public.gen_random_uuid() UNIQUE,
    group_jid VARCHAR(100) NOT NULL UNIQUE,            -- Identificador único del grupo (ej: 12036302482939@g.us)
    group_name VARCHAR(255),                            -- Nombre identificador del grupo (ej: Caja Central Mesas)
    sala_uuid UUID,                                     -- Sala a la que pertenece el grupo
    multisala_uuid UUID,                                -- Multisala opcional
    auto_reply BOOLEAN DEFAULT true,                    -- Enviar respuesta de confirmación al grupo
    is_active BOOLEAN DEFAULT true,                     -- Monitoreo activo
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Asegurar columna multisala_uuid si la tabla ya existía
ALTER TABLE public.whatsapp_group_mappings ADD COLUMN IF NOT EXISTS multisala_uuid UUID;

-- Eliminar columnas obsoletas si existían
ALTER TABLE public.whatsapp_group_mappings DROP COLUMN IF EXISTS modulo_destino;
ALTER TABLE public.whatsapp_group_mappings DROP COLUMN IF EXISTS caja_default;

-- Índices de búsqueda para public.whatsapp_group_mappings
CREATE INDEX IF NOT EXISTS idx_wa_mappings_jid ON public.whatsapp_group_mappings(group_jid);
CREATE INDEX IF NOT EXISTS idx_wa_mappings_sala ON public.whatsapp_group_mappings(sala_uuid);

-- 2. Tabla para registrar los logs y auditoría de todos los mensajes procesados
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT public.gen_random_uuid() UNIQUE,
    group_jid VARCHAR(100),                             -- JID del grupo donde se envió
    group_name VARCHAR(255),                            -- Nombre del grupo en ese momento
    sender_jid VARCHAR(100),                            -- JID del usuario emisor
    sender_name VARCHAR(255),                           -- Nombre del usuario en WhatsApp
    raw_message TEXT,                                   -- Mensaje original tal como se escribió
    parsed_data JSONB,                                  -- Objeto JSON con los datos extraídos (tipo, monto, cliente/operador, etc.)
    status VARCHAR(50),                                 -- 'procesado', 'sin_libro_activo', 'error_interno'
    error_message TEXT,                                 -- Detalle del error en caso de fallo
    inserted_record_uuid UUID,                          -- UUID del registro creado en libro_control_clientes o libro_aportes
    message_id VARCHAR(100),                            -- ID del mensaje de WhatsApp (para soportar ediciones)
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.whatsapp_logs ADD COLUMN IF NOT EXISTS message_id VARCHAR(100);
ALTER TABLE public.whatsapp_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Índices de búsqueda para public.whatsapp_logs
CREATE INDEX IF NOT EXISTS idx_wa_logs_created ON public.whatsapp_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_logs_jid ON public.whatsapp_logs(group_jid);
CREATE INDEX IF NOT EXISTS idx_wa_logs_status ON public.whatsapp_logs(status);
CREATE INDEX IF NOT EXISTS idx_wa_logs_msg_id ON public.whatsapp_logs(message_id);

-- 3. Tabla para el Diccionario Inteligente de WhatsApp (catálogo pre-indexado)
CREATE TABLE IF NOT EXISTS public.whatsapp_dictionary (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(50) NOT NULL,       -- 'empleado', 'rango', 'cliente', 'metodo_pago', 'maquina', 'modo'
    sala_uuid UUID,                       -- NULL para globales (rangos, métodos), o UUID de sala
    entity_uuid UUID NOT NULL,            -- UUID original en empleados, rangos, clientes, metodos_pago, maquinas
    nombre VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL,
    extra JSONB DEFAULT '{}'::jsonb,      -- tokens, cargo, cedula, aliases, serial, etc.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wa_dict_category ON public.whatsapp_dictionary(category);
CREATE INDEX IF NOT EXISTS idx_wa_dict_sala ON public.whatsapp_dictionary(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_wa_dict_norm_name ON public.whatsapp_dictionary(normalized_name);

-- 4. Tabla de metadata de sincronización del Diccionario
CREATE TABLE IF NOT EXISTS public.whatsapp_dictionary_meta (
    id INT PRIMARY KEY DEFAULT 1,
    last_synced_at TIMESTAMPTZ,
    stats JSONB DEFAULT '{}'::jsonb,
    synced_by VARCHAR(100) DEFAULT 'system'
);
