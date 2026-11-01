-- SCRIPT DDL: CREACIÓN DE TABLAS ERP V1 (ADMINISTRATIVO, CONTABILIDAD, NÓMINA)
-- 100% UUID STRICT - SIN COLUMNA ID

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. SECCIÓN ADMINISTRATIVO
-- ============================================================================

-- Artículos e Inventario
CREATE TABLE IF NOT EXISTS erp_articulos (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    categoria VARCHAR(100) DEFAULT 'General',
    unidad VARCHAR(50) DEFAULT 'Unidad',
    stock NUMERIC(14, 2) DEFAULT 0.00,
    costo_usd NUMERIC(18, 4) DEFAULT 0.0000,
    precio_usd NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Proveedores
CREATE TABLE IF NOT EXISTS erp_proveedores (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rif VARCHAR(30) UNIQUE NOT NULL,
    razon_social VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    email VARCHAR(150),
    direccion TEXT,
    porcentaje_retencion_iva VARCHAR(10) DEFAULT '75%', -- 75% o 100%
    saldo_pendiente_usd NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Facturas de Ventas (SENIAT Fiscal)
CREATE TABLE IF NOT EXISTS erp_facturas_ventas (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nro_factura VARCHAR(50) UNIQUE NOT NULL,
    nro_control VARCHAR(50) NOT NULL,
    cliente_nombre VARCHAR(255) NOT NULL,
    cliente_rif VARCHAR(30) NOT NULL,
    fecha DATE DEFAULT CURRENT_DATE,
    tasa_bcv NUMERIC(18, 4) DEFAULT 1.0000,
    monto_base_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_iva_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_igtf_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_total_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_total_ves NUMERIC(18, 4) DEFAULT 0.0000,
    pagado_en_divisas BOOLEAN DEFAULT true,
    estado VARCHAR(30) DEFAULT 'EMITIDA', -- EMITIDA, ANULADA_NC
    nota_credito_ref VARCHAR(50),
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Detalles de Factura de Venta
CREATE TABLE IF NOT EXISTS erp_facturas_ventas_detalles (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factura_uuid UUID NOT NULL REFERENCES erp_facturas_ventas(uuid) ON DELETE CASCADE,
    articulo_uuid UUID REFERENCES erp_articulos(uuid) ON DELETE SET NULL,
    descripcion VARCHAR(255) NOT NULL,
    cantidad NUMERIC(14, 2) DEFAULT 1.00,
    precio_unitario_usd NUMERIC(18, 4) DEFAULT 0.0000,
    subtotal_usd NUMERIC(18, 4) DEFAULT 0.0000,
    exento BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Facturas de Compras
CREATE TABLE IF NOT EXISTS erp_facturas_compras (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_uuid UUID NOT NULL REFERENCES erp_proveedores(uuid) ON DELETE RESTRICT,
    nro_factura_proveedor VARCHAR(50) NOT NULL,
    nro_control VARCHAR(50),
    fecha DATE DEFAULT CURRENT_DATE,
    tasa_bcv NUMERIC(18, 4) DEFAULT 1.0000,
    base_imponible_usd NUMERIC(18, 4) DEFAULT 0.0000,
    iva_usd NUMERIC(18, 4) DEFAULT 0.0000,
    retencion_iva_usd NUMERIC(18, 4) DEFAULT 0.0000,
    total_usd NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 2. SECCIÓN CONTABILIDAD
-- ============================================================================

-- Plan Único de Cuentas (Jerárquico)
CREATE TABLE IF NOT EXISTS erp_plan_cuentas (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    nivel INTEGER DEFAULT 1,
    tipo VARCHAR(20) DEFAULT 'DETALLE', -- GRUPO, DETALLE
    naturaleza VARCHAR(20) DEFAULT 'DEUDORA', -- DEUDORA, ACREEDORA
    parent_uuid UUID REFERENCES erp_plan_cuentas(uuid) ON DELETE SET NULL,
    saldo NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Centros de Costos
CREATE TABLE IF NOT EXISTS erp_centros_costos (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    responsable VARCHAR(150),
    presupuesto_usd NUMERIC(18, 4) DEFAULT 0.0000,
    ejecutado_usd NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comprobantes y Asientos Contables (Partida Doble)
CREATE TABLE IF NOT EXISTS erp_asientos_contables (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nro_comprobante VARCHAR(50) UNIQUE NOT NULL,
    fecha DATE DEFAULT CURRENT_DATE,
    glosa TEXT NOT NULL,
    tipo VARCHAR(20) DEFAULT 'DIARIO', -- DIARIO, INGRESO, EGRESO
    estado VARCHAR(20) DEFAULT 'ASENTADO', -- BORRADOR, ASENTADO, ANULADO
    total_debe_usd NUMERIC(18, 4) DEFAULT 0.0000,
    total_haber_usd NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Detalles / Líneas del Asiento
CREATE TABLE IF NOT EXISTS erp_asientos_detalles (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asiento_uuid UUID NOT NULL REFERENCES erp_asientos_contables(uuid) ON DELETE CASCADE,
    cuenta_uuid UUID NOT NULL REFERENCES erp_plan_cuentas(uuid) ON DELETE RESTRICT,
    centro_costo_uuid UUID REFERENCES erp_centros_costos(uuid) ON DELETE SET NULL,
    referencia VARCHAR(100),
    debe NUMERIC(18, 4) DEFAULT 0.0000,
    haber NUMERIC(18, 4) DEFAULT 0.0000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 3. SECCIÓN NÓMINA (LOTTT)
-- ============================================================================

-- Conceptos y Fórmulas
CREATE TABLE IF NOT EXISTS erp_nomina_conceptos (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(20) NOT NULL, -- ASIGNACION, DEDUCCION
    formula TEXT NOT NULL,
    gravable_ivss BOOLEAN DEFAULT false,
    gravable_faov BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Períodos de Nómina (Quincenal / Semanal)
CREATE TABLE IF NOT EXISTS erp_nomina_periodos (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    fecha_desde DATE NOT NULL,
    fecha_hasta DATE NOT NULL,
    tipo_frecuencia VARCHAR(20) DEFAULT 'QUINCENAL',
    estado VARCHAR(20) DEFAULT 'EN_BORRADOR', -- EN_BORRADOR, APROBADA, PAGADA
    tasa_bcv NUMERIC(18, 4) DEFAULT 1.0000,
    total_asignaciones_usd NUMERIC(18, 4) DEFAULT 0.0000,
    total_deducciones_usd NUMERIC(18, 4) DEFAULT 0.0000,
    total_neto_usd NUMERIC(18, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recibos Individuales de Pago (Conectado con empleados por UUID)
CREATE TABLE IF NOT EXISTS erp_nomina_recibos (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    periodo_uuid UUID NOT NULL REFERENCES erp_nomina_periodos(uuid) ON DELETE CASCADE,
    empleado_uuid UUID NOT NULL REFERENCES empleados(uuid) ON DELETE RESTRICT,
    sueldo_base_usd NUMERIC(18, 4) DEFAULT 0.0000,
    total_asignaciones_usd NUMERIC(18, 4) DEFAULT 0.0000,
    total_deducciones_usd NUMERIC(18, 4) DEFAULT 0.0000,
    neto_pagar_usd NUMERIC(18, 4) DEFAULT 0.0000,
    neto_pagar_ves NUMERIC(18, 4) DEFAULT 0.0000,
    banco VARCHAR(100),
    nro_cuenta VARCHAR(50),
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Líneas de Recibo de Pago (Desglose individual)
CREATE TABLE IF NOT EXISTS erp_nomina_recibos_detalles (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recibo_uuid UUID NOT NULL REFERENCES erp_nomina_recibos(uuid) ON DELETE CASCADE,
    concepto_uuid UUID REFERENCES erp_nomina_conceptos(uuid) ON DELETE SET NULL,
    concepto_nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(20) NOT NULL, -- ASIGNACION, DEDUCCION
    monto_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_ves NUMERIC(18, 4) DEFAULT 0.0000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prestaciones Sociales Acumuladas (Art. 142 LOTTT)
CREATE TABLE IF NOT EXISTS erp_nomina_prestaciones_acumulados (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empleado_uuid UUID NOT NULL REFERENCES empleados(uuid) ON DELETE CASCADE,
    fecha_corte DATE DEFAULT CURRENT_DATE,
    dias_garantia INTEGER DEFAULT 15,
    salario_integral_diario_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_garantia_usd NUMERIC(18, 4) DEFAULT 0.0000,
    monto_intereses_usd NUMERIC(18, 4) DEFAULT 0.0000,
    tasa_interes_bcv NUMERIC(8, 4) DEFAULT 0.0000,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
