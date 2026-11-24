-- =========================================================================
-- MIGRACIÓN: TABLAS DEL DICCIONARIO INTELIGENTE DE WHATSAPP PARA WISI
-- =========================================================================
-- NOTA: Este script NO altera ni modifica ninguna tabla existente del sistema.
-- Únicamente crea las 2 tablas de soporte para el catálogo pre-indexado en RAM
-- y persistente para la resolución de empleados, rangos, clientes y métodos.
-- =========================================================================

-- Asegurar extensión para gen_random_uuid si no existe
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabla para almacenar el catálogo pre-indexado del diccionario por sala y categoría
CREATE TABLE IF NOT EXISTS public.whatsapp_dictionary (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(50) NOT NULL,       -- 'empleado', 'rango', 'cliente', 'metodo_pago', 'maquina', 'modo'
    sala_uuid UUID,                       -- NULL para globales (rangos, métodos), o UUID de la sala asignada
    entity_uuid UUID NOT NULL,            -- UUID original de la entidad en su respectiva tabla
    nombre VARCHAR(255) NOT NULL,         -- Nombre saneado
    normalized_name VARCHAR(255) NOT NULL,-- Nombre normalizado (minúsculas, sin acentos)
    extra JSONB DEFAULT '{}'::jsonb,      -- Metadatos: { cargo, cedula, aliases, tokens, serial, etc. }
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Índices para búsquedas de alta velocidad
CREATE INDEX IF NOT EXISTS idx_wa_dict_category ON public.whatsapp_dictionary(category);
CREATE INDEX IF NOT EXISTS idx_wa_dict_sala ON public.whatsapp_dictionary(sala_uuid);
CREATE INDEX IF NOT EXISTS idx_wa_dict_norm_name ON public.whatsapp_dictionary(normalized_name);

-- 2. Tabla de control y metadata de sincronización del diccionario
CREATE TABLE IF NOT EXISTS public.whatsapp_dictionary_meta (
    id INT PRIMARY KEY DEFAULT 1,
    last_synced_at TIMESTAMPTZ,
    stats JSONB DEFAULT '{}'::jsonb,
    synced_by VARCHAR(100) DEFAULT 'system'
);
