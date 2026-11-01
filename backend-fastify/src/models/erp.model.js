import { isPgConnected, sql } from '../config/db.js';
import { randomUUID } from 'crypto';
import { getCortesModel, getCorteByIdModel } from './master.model.js';

export function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

// ============================================================================
// 1. MÓDULO ADMINISTRATIVO
// ============================================================================

export async function getArticulosModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, codigo, nombre, categoria, unidad, 
        stock::numeric as stock, 
        costo_usd::numeric as costo_usd, 
        precio_usd::numeric as precio_usd,
        created_at
      FROM erp_articulos
      WHERE is_deleted = false
      ORDER BY codigo ASC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getArticulosModel:', err.message);
    return [];
  }
}

export async function saveArticuloModel(data) {
  if (!sql) throw new Error('Database not connected');
  const uuid = isUuid(data.uuid) ? data.uuid : randomUUID();
  const codigo = String(data.codigo || '').trim() || `ART-${Date.now().toString().slice(-4)}`;
  const nombre = String(data.nombre || '').trim();
  const categoria = String(data.categoria || 'General').trim();
  const unidad = String(data.unidad || 'Unidad').trim();
  const stock = Number(data.stock) || 0;
  const costo_usd = Number(data.costo_usd) || 0;
  const precio_usd = Number(data.precio_usd) || 0;

  const [row] = await sql`
    INSERT INTO erp_articulos (uuid, codigo, nombre, categoria, unidad, stock, costo_usd, precio_usd)
    VALUES (${uuid}, ${codigo}, ${nombre}, ${categoria}, ${unidad}, ${stock}, ${costo_usd}, ${precio_usd})
    ON CONFLICT (uuid) DO UPDATE SET
      codigo = EXCLUDED.codigo,
      nombre = EXCLUDED.nombre,
      categoria = EXCLUDED.categoria,
      unidad = EXCLUDED.unidad,
      stock = EXCLUDED.stock,
      costo_usd = EXCLUDED.costo_usd,
      precio_usd = EXCLUDED.precio_usd,
      updated_at = NOW()
    RETURNING *;
  `;
  return row;
}

export async function deleteArticuloModel(uuid) {
  if (!sql || !isUuid(uuid)) return false;
  await sql`UPDATE erp_articulos SET is_deleted = true, updated_at = NOW() WHERE uuid = ${uuid};`;
  return true;
}

export async function registrarMovimientoInventarioModel(data) {
  if (!sql) throw new Error('Database not connected');
  const artUuid = data.articulo_uuid;
  const tipo = String(data.tipo || 'ENTRADA').toUpperCase(); // 'ENTRADA' | 'SALIDA' | 'AJUSTE'
  const cantidad = Number(data.cantidad) || 0;

  let query;
  if (tipo === 'ENTRADA') {
    query = sql`UPDATE erp_articulos SET stock = stock + ${cantidad}, updated_at = NOW() WHERE uuid = ${artUuid} RETURNING *;`;
  } else if (tipo === 'SALIDA') {
    query = sql`UPDATE erp_articulos SET stock = GREATEST(0, stock - ${cantidad}), updated_at = NOW() WHERE uuid = ${artUuid} RETURNING *;`;
  } else {
    query = sql`UPDATE erp_articulos SET stock = ${cantidad}, updated_at = NOW() WHERE uuid = ${artUuid} RETURNING *;`;
  }
  const [art] = await query;
  return art;
}

export async function getProveedoresModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, rif, razon_social as nombre, telefono, email, direccion,
        porcentaje_retencion_iva as retencion_iva,
        saldo_pendiente_usd::numeric as saldo_pendiente_usd,
        created_at
      FROM erp_proveedores
      WHERE is_deleted = false
      ORDER BY razon_social ASC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getProveedoresModel:', err.message);
    return [];
  }
}

export async function saveProveedorModel(data) {
  if (!sql) throw new Error('Database not connected');
  const uuid = isUuid(data.uuid) ? data.uuid : randomUUID();
  const rif = String(data.rif || '').trim().toUpperCase();
  const razon_social = String(data.nombre || data.razon_social || '').trim();
  const telefono = String(data.telefono || '').trim();
  const retencion_iva = String(data.retencion_iva || data.porcentaje_retencion_iva || '75%').trim();
  const saldo_pendiente_usd = Number(data.saldo_pendiente_usd) || 0;

  const [row] = await sql`
    INSERT INTO erp_proveedores (uuid, rif, razon_social, telefono, porcentaje_retencion_iva, saldo_pendiente_usd)
    VALUES (${uuid}, ${rif}, ${razon_social}, ${telefono}, ${retencion_iva}, ${saldo_pendiente_usd})
    ON CONFLICT (uuid) DO UPDATE SET
      rif = EXCLUDED.rif,
      razon_social = EXCLUDED.razon_social,
      telefono = EXCLUDED.telefono,
      porcentaje_retencion_iva = EXCLUDED.porcentaje_retencion_iva,
      saldo_pendiente_usd = EXCLUDED.saldo_pendiente_usd,
      updated_at = NOW()
    RETURNING *;
  `;
  return row;
}

export async function registrarPagoProveedorModel(data) {
  if (!sql) throw new Error('Database not connected');
  const prvUuid = data.proveedor_uuid;
  const montoUsd = Number(data.monto_usd) || 0;
  const medioPago = String(data.medio_pago || 'TRANSFERENCIA').toUpperCase();
  const referencia = String(data.referencia || '').trim();

  // Actualizar saldo pendiente del proveedor
  const [prv] = await sql`
    UPDATE erp_proveedores
    SET saldo_pendiente_usd = GREATEST(0, saldo_pendiente_usd - ${montoUsd}),
        updated_at = NOW()
    WHERE uuid = ${prvUuid}
    RETURNING *;
  `;

  // Asiento contable del egreso / pago
  try {
    const asntUuid = randomUUID();
    const [{ asntCount }] = await sql`SELECT count(*)::int as asntCount FROM erp_asientos_contables;`;
    const asntNro = `AS-2026-${String(asntCount + 44).padStart(4, '0')}`;
    const fecha = data.fecha || new Date().toISOString().split('T')[0];
    const glosa = `Pago a Proveedor ${prv?.razon_social || prvUuid} - Ref: ${referencia}`;

    await sql`
      INSERT INTO erp_asientos_contables (
        uuid, nro_comprobante, fecha, glosa, tipo, estado, total_debe_usd, total_haber_usd
      ) VALUES (
        ${asntUuid}, ${asntNro}, ${fecha}, ${glosa}, 'EGRESO', 'ASENTADO', ${montoUsd}, ${montoUsd}
      );
    `;

    // 1. Debe: Cuentas por Pagar Proveedores (2.1.1.01)
    const [cxpRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.1.01' LIMIT 1;`;
    if (cxpRow) {
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
        VALUES (${randomUUID()}, ${asntUuid}, ${cxpRow.uuid}, ${montoUsd}, 0.00, ${referencia});
      `;
      await sql`UPDATE erp_plan_cuentas SET saldo = GREATEST(0, saldo - ${montoUsd}), updated_at = NOW() WHERE uuid = ${cxpRow.uuid};`;
    }

    // 2. Haber: Banco (1.1.1.03) o Caja Bóveda (1.1.1.02)
    const ctaEfectivo = medioPago === 'EFECTIVO' ? '1.1.1.02' : '1.1.1.03';
    const [bancoRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = ${ctaEfectivo} LIMIT 1;`;
    if (bancoRow) {
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
        VALUES (${randomUUID()}, ${asntUuid}, ${bancoRow.uuid}, 0.00, ${montoUsd}, ${referencia});
      `;
      await sql`UPDATE erp_plan_cuentas SET saldo = saldo - ${montoUsd}, updated_at = NOW() WHERE uuid = ${bancoRow.uuid};`;
    }
  } catch (errAsnt) {
    console.warn('Advertencia generación asiento pago proveedor:', errAsnt.message);
  }

  return prv;
}

export async function getFacturasVentasModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, 
        nro_factura as nro, 
        nro_control as control, 
        cliente_nombre as cliente, 
        cliente_rif as rif, 
        to_char(fecha, 'YYYY-MM-DD') as fecha,
        tasa_bcv::numeric as tasa_bcv,
        monto_base_usd::numeric as base_usd,
        monto_iva_usd::numeric as iva_usd,
        monto_igtf_usd::numeric as igtf_usd,
        monto_total_usd::numeric as total_usd,
        monto_total_ves::numeric as total_ves,
        pagado_en_divisas as pagado_divisas,
        estado,
        created_at
      FROM erp_facturas_ventas
      WHERE is_deleted = false
      ORDER BY fecha DESC, created_at DESC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getFacturasVentasModel:', err.message);
    return [];
  }
}

export async function createFacturaVentaModel(data) {
  if (!sql) throw new Error('Database not connected');
  const facUuid = isUuid(data.uuid) ? data.uuid : randomUUID();
  const cliente = String(data.cliente || '').trim();
  const rif = String(data.rif || '').trim().toUpperCase();
  const tasaBcv = Number(data.tasa_bcv) || 62.50;
  const baseUsd = Number(data.monto_base_usd || data.base_usd) || 0;
  const ivaUsd = Number((baseUsd * 0.16).toFixed(4));
  const aplicaIgtf = Boolean(data.aplica_igtf || data.pagado_divisas);
  const igtfUsd = aplicaIgtf ? Number(((baseUsd + ivaUsd) * 0.03).toFixed(4)) : 0;
  const totalUsd = Number((baseUsd + ivaUsd + igtfUsd).toFixed(4));
  const totalVes = Number((totalUsd * tasaBcv).toFixed(2));
  const fecha = data.fecha || new Date().toISOString().split('T')[0];

  // Conteo para correlativo correlacionado
  const [{ count }] = await sql`SELECT count(*)::int as count FROM erp_facturas_ventas;`;
  const nroSiguiente = count + 125;
  const nroCtrlSiguiente = count + 855;
  const nroFactura = data.nro || `FAC-${String(nroSiguiente).padStart(6, '0')}`;
  const nroControl = data.control || `00-${String(nroCtrlSiguiente).padStart(6, '0')}`;

  const [created] = await sql`
    INSERT INTO erp_facturas_ventas (
      uuid, nro_factura, nro_control, cliente_nombre, cliente_rif, fecha,
      tasa_bcv, monto_base_usd, monto_iva_usd, monto_igtf_usd, monto_total_usd,
      monto_total_ves, pagado_en_divisas, estado
    ) VALUES (
      ${facUuid}, ${nroFactura}, ${nroControl}, ${cliente}, ${rif}, ${fecha},
      ${tasaBcv}, ${baseUsd}, ${ivaUsd}, ${igtfUsd}, ${totalUsd},
      ${totalVes}, ${aplicaIgtf}, 'EMITIDA'
    )
    RETURNING *;
  `;

  // --- FASE 3: GENERACIÓN AUTOMÁTICA DE ASIENTO CONTABLE (VENTA FISCAL SENIAT) ---
  try {
    const asntUuid = randomUUID();
    const [{ asntCount }] = await sql`SELECT count(*)::int as asntCount FROM erp_asientos_contables;`;
    const asntNro = `AS-2026-${String(asntCount + 44).padStart(4, '0')}`;
    const glosaVenta = `Registro automático de Venta Fiscal ${nroFactura} - Cliente: ${cliente} (${rif})`;

    await sql`
      INSERT INTO erp_asientos_contables (
        uuid, nro_comprobante, fecha, glosa, tipo, estado, total_debe_usd, total_haber_usd
      ) VALUES (
        ${asntUuid}, ${asntNro}, ${fecha}, ${glosaVenta}, 'INGRESO', 'ASENTADO', ${totalUsd}, ${totalUsd}
      );
    `;

    // 1. Debe: Caja Divisas (1.1.1.02) o Caja Bs (1.1.1.01)
    const ctaCaja = aplicaIgtf ? '1.1.1.02' : '1.1.1.01';
    const [cajaRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = ${ctaCaja} LIMIT 1;`;
    if (cajaRow) {
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
        VALUES (${randomUUID()}, ${asntUuid}, ${cajaRow.uuid}, ${totalUsd}, 0.00, ${nroFactura});
      `;
      await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${totalUsd}, updated_at = NOW() WHERE uuid = ${cajaRow.uuid};`;
    }

    // 2. Haber: Ingresos Operacionales (4.1.1.01)
    const [ingRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '4.1.1.01' LIMIT 1;`;
    if (ingRow) {
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
        VALUES (${randomUUID()}, ${asntUuid}, ${ingRow.uuid}, 0.00, ${baseUsd}, ${nroFactura});
      `;
      await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${baseUsd}, updated_at = NOW() WHERE uuid = ${ingRow.uuid};`;
    }

    // 3. Haber: Débito Fiscal IVA SENIAT + IGTF (2.1.2.01)
    const impTotales = Number((ivaUsd + igtfUsd).toFixed(4));
    if (impTotales > 0) {
      const [ivaRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.2.01' LIMIT 1;`;
      if (ivaRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${ivaRow.uuid}, 0.00, ${impTotales}, ${nroFactura});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${impTotales}, updated_at = NOW() WHERE uuid = ${ivaRow.uuid};`;
      }
    }
  } catch (errAsnt) {
    console.warn('Advertencia generación automática asiento venta:', errAsnt.message);
  }

  return created;
}

export async function anularFacturaVentaModel(uuid) {
  if (!sql || !isUuid(uuid)) return null;
  const [updated] = await sql`
    UPDATE erp_facturas_ventas
    SET estado = 'ANULADA_NC', updated_at = NOW()
    WHERE uuid = ${uuid}
    RETURNING *;
  `;

  if (updated) {
    // --- FASE 3: GENERACIÓN AUTOMÁTICA DE CONTRASIENTO CONTABLE (ANULACIÓN NC) ---
    try {
      const asntUuid = randomUUID();
      const [{ asntCount }] = await sql`SELECT count(*)::int as asntCount FROM erp_asientos_contables;`;
      const asntNro = `AS-2026-${String(asntCount + 44).padStart(4, '0')}`;
      const glosaNc = `Contrasiento por Anulación NC de Factura ${updated.nro_factura} - Cliente: ${updated.cliente_nombre}`;
      const totalUsd = Number(updated.monto_total_usd);
      const baseUsd = Number(updated.monto_base_usd);
      const impUsd = Number(updated.monto_iva_usd) + Number(updated.monto_igtf_usd);
      const fecha = new Date().toISOString().split('T')[0];

      await sql`
        INSERT INTO erp_asientos_contables (
          uuid, nro_comprobante, fecha, glosa, tipo, estado, total_debe_usd, total_haber_usd
        ) VALUES (
          ${asntUuid}, ${asntNro}, ${fecha}, ${glosaNc}, 'EGRESO', 'ASENTADO', ${totalUsd}, ${totalUsd}
        );
      `;

      // 1. Debe: Reversa de Ingresos (4.1.1.01)
      const [ingRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '4.1.1.01' LIMIT 1;`;
      if (ingRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${ingRow.uuid}, ${baseUsd}, 0.00, 'NC-' || ${updated.nro_factura});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = GREATEST(0, saldo - ${baseUsd}), updated_at = NOW() WHERE uuid = ${ingRow.uuid};`;
      }

      // 2. Debe: Reversa de IVA Débito Fiscal (2.1.2.01)
      if (impUsd > 0) {
        const [ivaRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.2.01' LIMIT 1;`;
        if (ivaRow) {
          await sql`
            INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
            VALUES (${randomUUID()}, ${asntUuid}, ${ivaRow.uuid}, ${impUsd}, 0.00, 'NC-' || ${updated.nro_factura});
          `;
          await sql`UPDATE erp_plan_cuentas SET saldo = GREATEST(0, saldo - ${impUsd}), updated_at = NOW() WHERE uuid = ${ivaRow.uuid};`;
        }
      }

      // 3. Haber: Salida de Caja / Divisas (1.1.1.02 o 1.1.1.01)
      const ctaCaja = updated.pagado_en_divisas ? '1.1.1.02' : '1.1.1.01';
      const [cajaRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = ${ctaCaja} LIMIT 1;`;
      if (cajaRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${cajaRow.uuid}, 0.00, ${totalUsd}, 'NC-' || ${updated.nro_factura});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = GREATEST(0, saldo - ${totalUsd}), updated_at = NOW() WHERE uuid = ${cajaRow.uuid};`;
      }
    } catch (errAsnt) {
      console.warn('Advertencia generación contrasiento NC:', errAsnt.message);
    }
  }

  return updated;
}

export async function createFacturaCompraModel(data) {
  if (!sql) throw new Error('Database not connected');
  const fcUuid = isUuid(data.uuid) ? data.uuid : randomUUID();
  const proveedorUuid = data.proveedor_uuid;
  if (!isUuid(proveedorUuid)) {
    throw new Error('Proveedor no válido o no seleccionado');
  }
  const nroFactura = String(data.nro_factura || data.nro || '').trim();
  const nroControl = String(data.nro_control || data.control || '').trim();
  const fecha = data.fecha || new Date().toISOString().split('T')[0];
  const tasaBcv = Number(data.tasa_bcv) || 62.50;
  const baseUsd = Number(data.base_imponible_usd || data.base_usd) || 0;
  const ivaUsd = Number((baseUsd * 0.16).toFixed(4));
  const porcRet = data.porcentaje_retencion === '100%' ? 1.0 : 0.75;
  const retIvaUsd = Number((ivaUsd * porcRet).toFixed(4));
  const totalUsd = Number((baseUsd + ivaUsd).toFixed(4));
  const saldoAPagarUsd = Number((totalUsd - retIvaUsd).toFixed(4));

  const [created] = await sql`
    INSERT INTO erp_facturas_compras (
      uuid, proveedor_uuid, nro_factura_proveedor, nro_control, fecha,
      tasa_bcv, base_imponible_usd, iva_usd, retencion_iva_usd, total_usd
    ) VALUES (
      ${fcUuid}, ${proveedorUuid}, ${nroFactura}, ${nroControl}, ${fecha},
      ${tasaBcv}, ${baseUsd}, ${ivaUsd}, ${retIvaUsd}, ${totalUsd}
    )
    RETURNING *;
  `;

  // Actualizar saldo pendiente del proveedor
  await sql`
    UPDATE erp_proveedores
    SET saldo_pendiente_usd = saldo_pendiente_usd + ${saldoAPagarUsd}, updated_at = NOW()
    WHERE uuid = ${proveedorUuid};
  `;

  // --- FASE 3: GENERACIÓN AUTOMÁTICA DE ASIENTO CONTABLE (COMPRA A PROVEEDOR) ---
  try {
    const asntUuid = randomUUID();
    const [{ asntCount }] = await sql`SELECT count(*)::int as asntCount FROM erp_asientos_contables;`;
    const asntNro = `AS-2026-${String(asntCount + 44).padStart(4, '0')}`;
    const [prv] = await sql`SELECT razon_social, rif FROM erp_proveedores WHERE uuid = ${proveedorUuid};`;
    const prvNombre = prv ? `${prv.razon_social} (${prv.rif})` : 'Proveedor';
    const glosaCompra = `Registro automático de Compra Fact. ${nroFactura} - Proveedor: ${prvNombre}`;

    await sql`
      INSERT INTO erp_asientos_contables (
        uuid, nro_comprobante, fecha, glosa, tipo, estado, total_debe_usd, total_haber_usd
      ) VALUES (
        ${asntUuid}, ${asntNro}, ${fecha}, ${glosaCompra}, 'EGRESO', 'ASENTADO', ${totalUsd}, ${totalUsd}
      );
    `;

    // 1. Debe: Gastos de Mantenimiento y Servicios (5.1.2.01)
    const [gastoRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '5.1.2.01' LIMIT 1;`;
    if (gastoRow) {
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
        VALUES (${randomUUID()}, ${asntUuid}, ${gastoRow.uuid}, ${baseUsd}, 0.00, ${nroFactura});
      `;
      await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${baseUsd}, updated_at = NOW() WHERE uuid = ${gastoRow.uuid};`;
    }

    // 2. Debe: IVA Crédito Fiscal (1.1.2.01)
    if (ivaUsd > 0) {
      const [ivaRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '1.1.2.01' LIMIT 1;`;
      if (ivaRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${ivaRow.uuid}, ${ivaUsd}, 0.00, ${nroFactura});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${ivaUsd}, updated_at = NOW() WHERE uuid = ${ivaRow.uuid};`;
      }
    }

    // 3. Haber: Cuentas por Pagar Proveedores (2.1.1.01)
    const [cxpRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.1.01' LIMIT 1;`;
    if (cxpRow) {
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
        VALUES (${randomUUID()}, ${asntUuid}, ${cxpRow.uuid}, 0.00, ${saldoAPagarUsd}, ${nroFactura});
      `;
      await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${saldoAPagarUsd}, updated_at = NOW() WHERE uuid = ${cxpRow.uuid};`;
    }

    // 4. Haber: Retenciones de IVA por Enterar (2.1.2.01)
    if (retIvaUsd > 0) {
      const [retRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.2.01' LIMIT 1;`;
      if (retRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${retRow.uuid}, 0.00, ${retIvaUsd}, 'RET-IVA-' || ${nroFactura});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${retIvaUsd}, updated_at = NOW() WHERE uuid = ${retRow.uuid};`;
      }
    }
  } catch (errAsnt) {
    console.warn('Advertencia generación automática asiento compra:', errAsnt.message);
  }

  return created;
}

export async function getFacturasComprasModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        fc.uuid, fc.nro_factura_proveedor, fc.nro_control,
        to_char(fc.fecha, 'YYYY-MM-DD') as fecha,
        fc.tasa_bcv::numeric,
        fc.base_imponible_usd::numeric,
        fc.iva_usd::numeric,
        fc.retencion_iva_usd::numeric,
        fc.total_usd::numeric,
        p.razon_social as proveedor_nombre,
        p.rif as proveedor_rif
      FROM erp_facturas_compras fc
      JOIN erp_proveedores p ON p.uuid = fc.proveedor_uuid
      WHERE fc.is_deleted = false
      ORDER BY fc.fecha DESC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getFacturasComprasModel:', err.message);
    return [];
  }
}

export async function getCxcCxpSummaryModel() {
  if (!sql) return { total_cxc_usd: 3420, total_cxp_usd: 765 };
  try {
    const [cxpRow] = await sql`
      SELECT COALESCE(SUM(saldo_pendiente_usd), 0)::numeric as total_cxp_usd
      FROM erp_proveedores
      WHERE is_deleted = false;
    `;
    return {
      total_cxc_usd: 3420.00,
      total_cxp_usd: Number(cxpRow?.total_cxp_usd) || 765.00
    };
  } catch (err) {
    return { total_cxc_usd: 3420.00, total_cxp_usd: 765.00 };
  }
}

export async function getReporteFiscalSeniatModel() {
  if (!sql) return { ventas: [], compras: [], resumen: {} };
  try {
    const ventas = await getFacturasVentasModel();
    const compras = await getFacturasComprasModel();

    const totalVentasBaseUsd = ventas.filter(v => v.estado !== 'ANULADA_NC').reduce((acc, v) => acc + (Number(v.base_usd) || 0), 0);
    const totalVentasIvaUsd = ventas.filter(v => v.estado !== 'ANULADA_NC').reduce((acc, v) => acc + (Number(v.iva_usd) || 0), 0);
    const totalIgtfUsd = ventas.filter(v => v.estado !== 'ANULADA_NC').reduce((acc, v) => acc + (Number(v.igtf_usd) || 0), 0);

    const totalComprasBaseUsd = compras.reduce((acc, c) => acc + (Number(c.base_imponible_usd) || 0), 0);
    const totalComprasIvaUsd = compras.reduce((acc, c) => acc + (Number(c.iva_usd) || 0), 0);
    const totalRetencionesIvaUsd = compras.reduce((acc, c) => acc + (Number(c.retencion_iva_usd) || 0), 0);

    const saldoIvaUsd = Number((totalVentasIvaUsd - totalComprasIvaUsd - totalRetencionesIvaUsd).toFixed(2));

    return {
      ventas,
      compras,
      resumen: {
        total_ventas_base_usd: totalVentasBaseUsd,
        total_debito_fiscal_usd: totalVentasIvaUsd,
        total_igtf_usd: totalIgtfUsd,
        total_compras_base_usd: totalComprasBaseUsd,
        total_credito_fiscal_usd: totalComprasIvaUsd,
        total_retenciones_iva_usd: totalRetencionesIvaUsd,
        saldo_iva_usd: saldoIvaUsd,
        posicion_fiscal: saldoIvaUsd >= 0 ? 'IMPUESTO A ENTERAR (PAGO SENIAT)' : 'SALDO A FAVOR DEL CONTRIBUYENTE'
      }
    };
  } catch (err) {
    console.error('Error getReporteFiscalSeniatModel:', err.message);
    return { ventas: [], compras: [], resumen: {} };
  }
}

// ============================================================================
// 2. MÓDULO CONTABILIDAD
// ============================================================================

export async function getPlanCuentasModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, codigo, nombre, nivel, tipo, naturaleza, 
        saldo::numeric as saldo
      FROM erp_plan_cuentas
      WHERE is_deleted = false
      ORDER BY codigo ASC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getPlanCuentasModel:', err.message);
    return [];
  }
}

export async function saveCuentaModel(data) {
  if (!sql) throw new Error('Database not connected');
  const uuid = isUuid(data.uuid) ? data.uuid : randomUUID();
  const codigo = String(data.codigo || '').trim();
  const nombre = String(data.nombre || '').trim();
  const nivel = Number(data.nivel) || 4;
  const tipo = String(data.tipo || 'DETALLE').trim().toUpperCase();
  const naturaleza = String(data.naturaleza || 'DEUDORA').trim().toUpperCase();

  const [row] = await sql`
    INSERT INTO erp_plan_cuentas (uuid, codigo, nombre, nivel, tipo, naturaleza, saldo)
    VALUES (${uuid}, ${codigo}, ${nombre}, ${nivel}, ${tipo}, ${naturaleza}, 0.0000)
    ON CONFLICT (uuid) DO UPDATE SET
      codigo = EXCLUDED.codigo,
      nombre = EXCLUDED.nombre,
      nivel = EXCLUDED.nivel,
      tipo = EXCLUDED.tipo,
      naturaleza = EXCLUDED.naturaleza,
      updated_at = NOW()
    RETURNING *;
  `;
  return row;
}

export async function getCentrosCostosModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, codigo, nombre, responsable,
        presupuesto_usd::numeric as presupuesto_usd,
        ejecutado_usd::numeric as ejecutado_usd
      FROM erp_centros_costos
      WHERE is_deleted = false
      ORDER BY codigo ASC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getCentrosCostosModel:', err.message);
    return [];
  }
}

export async function getAsientosModel() {
  if (!sql) return [];
  try {
    const asientosRows = await sql`
      SELECT 
        a.uuid, 
        a.nro_comprobante as nro, 
        to_char(a.fecha, 'YYYY-MM-DD') as fecha,
        a.glosa, 
        a.tipo, 
        a.estado,
        a.total_debe_usd::numeric as total_debe,
        a.total_haber_usd::numeric as total_haber,
        a.created_at
      FROM erp_asientos_contables a
      WHERE a.is_deleted = false
      ORDER BY a.fecha DESC, a.created_at DESC;
    `;

    if (!asientosRows.length) return [];

    const asientoUuids = asientosRows.map(a => a.uuid);
    const detallesRows = await sql`
      SELECT 
        d.asiento_uuid,
        c.codigo as cuenta_codigo,
        c.nombre as cuenta_nombre,
        d.debe::numeric as debe,
        d.haber::numeric as haber
      FROM erp_asientos_detalles d
      JOIN erp_plan_cuentas c ON c.uuid = d.cuenta_uuid
      WHERE d.asiento_uuid IN ${sql(asientoUuids)}
      ORDER BY d.created_at ASC;
    `;

    const detallesPorAsiento = {};
    for (const d of detallesRows) {
      if (!detallesPorAsiento[d.asiento_uuid]) detallesPorAsiento[d.asiento_uuid] = [];
      detallesPorAsiento[d.asiento_uuid].push({
        cuenta_codigo: d.cuenta_codigo,
        cuenta_nombre: d.cuenta_nombre,
        debe: Number(d.debe),
        haber: Number(d.haber)
      });
    }

    return asientosRows.map(a => ({
      ...a,
      lineas: detallesPorAsiento[a.uuid] || []
    }));
  } catch (err) {
    console.error('Error getAsientosModel:', err.message);
    return [];
  }
}

export async function createAsientoModel(data) {
  if (!sql) throw new Error('Database not connected');
  const lineas = Array.isArray(data.lineas) ? data.lineas : [];
  if (lineas.length < 2) {
    throw new Error('Un comprobante contable requiere al menos 2 líneas de partida doble');
  }

  const totalDebe = lineas.reduce((acc, l) => acc + (Number(l.debe) || 0), 0);
  const totalHaber = lineas.reduce((acc, l) => acc + (Number(l.haber) || 0), 0);
  if (Math.abs(totalDebe - totalHaber) > 0.01 || totalDebe <= 0) {
    throw new Error(`Asiento descuadrado: Debe ($${totalDebe.toFixed(2)}) != Haber ($${totalHaber.toFixed(2)})`);
  }

  const asntUuid = isUuid(data.uuid) ? data.uuid : randomUUID();
  const [{ count }] = await sql`SELECT count(*)::int as count FROM erp_asientos_contables;`;
  const nroSiguiente = count + 43;
  const nroComprobante = data.nro || `AS-2026-${String(nroSiguiente).padStart(4, '0')}`;
  const glosa = String(data.glosa || '').trim();
  const tipo = String(data.tipo || 'DIARIO').trim();
  const fecha = data.fecha || new Date().toISOString().split('T')[0];

  // Ejecución atómica de Asiento y sus Detalles
  const [createdAsnt] = await sql`
    INSERT INTO erp_asientos_contables (
      uuid, nro_comprobante, fecha, glosa, tipo, estado, total_debe_usd, total_haber_usd
    ) VALUES (
      ${asntUuid}, ${nroComprobante}, ${fecha}, ${glosa}, ${tipo}, 'ASENTADO', ${totalDebe}, ${totalHaber}
    )
    RETURNING *;
  `;

  for (const l of lineas) {
    // Buscar la cuenta por código
    const [cuenta] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = ${String(l.cuenta_codigo).trim()} LIMIT 1;`;
    if (cuenta) {
      const detUuid = randomUUID();
      await sql`
        INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber)
        VALUES (${detUuid}, ${asntUuid}, ${cuenta.uuid}, ${Number(l.debe) || 0}, ${Number(l.haber) || 0});
      `;
    }
  }

  return createdAsnt;
}

export async function getEstadosFinancierosModel() {
  if (!sql) return null;
  try {
    const cuentas = await getPlanCuentasModel();
    const activos = cuentas.filter(c => c.codigo.startsWith('1'));
    const pasivos = cuentas.filter(c => c.codigo.startsWith('2'));
    const patrimonio = cuentas.filter(c => c.codigo.startsWith('3'));
    const ingresos = cuentas.filter(c => c.codigo.startsWith('4'));
    const egresos = cuentas.filter(c => c.codigo.startsWith('5'));

    const totalActivos = activos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
    const totalPasivos = pasivos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
    const totalPatrimonioBase = patrimonio.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);

    const totalIngresos = ingresos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
    const totalEgresos = egresos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
    const utilidadEjercicio = Number((totalIngresos - totalEgresos).toFixed(2));

    const totalPatrimonioNeto = Number((totalPatrimonioBase + utilidadEjercicio).toFixed(2));
    const balanceGeneralCuadrado = Math.abs(totalActivos - (totalPasivos + totalPatrimonioNeto)) < 0.05;

    return {
      estado_resultados: {
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        utilidad_ejercicio: utilidadEjercicio,
        detalles_ingresos: ingresos,
        detalles_egresos: egresos
      },
      balance_general: {
        total_activos: totalActivos,
        total_pasivos: totalPasivos,
        total_patrimonio_base: totalPatrimonioBase,
        utilidad_ejercicio: utilidadEjercicio,
        total_pasivo_patrimonio: totalPasivos + totalPatrimonioNeto,
        esta_cuadrado: balanceGeneralCuadrado,
        detalles_activos: activos,
        detalles_pasivos: pasivos,
        detalles_patrimonio: patrimonio
      }
    };
  } catch (err) {
    console.error('Error getEstadosFinancierosModel:', err.message);
    return null;
  }
}

// ============================================================================
// 3. MÓDULO NÓMINA (LOTTT)
// ============================================================================

export async function getPersonalNominaModel(options = {}) {
  if (!sql) return [];
  try {
    const userSalaUuids = Array.isArray(options.userSalaIds) ? options.userSalaIds.filter(Boolean) : [];
    const salaCond = userSalaUuids.length > 0 
      ? sql`AND (s.uuid = ANY(${userSalaUuids}::uuid[]) OR dep.sala_uuid = ANY(${userSalaUuids}::uuid[]))`
      : sql``;

    const rows = await sql`
      SELECT 
        e.uuid,
        e.cedula,
        e.nombre as nombres,
        e.nombre,
        COALESCE(c.nombre, 'Empleado Operativo') as cargo,
        COALESCE(dep.nombre, 'Operaciones de Sala') as departamento,
        COALESCE(s.nombre, 'Principal') as sala_nombre,
        COALESCE(s.uuid, dep.sala_uuid) as sala_uuid,
        450.00::numeric as sueldo_base_usd,
        'Banesco' as banco,
        '0134-0192-38-4920192837' as nro_cuenta,
        CASE WHEN e.activo = false THEN 'INACTIVO' ELSE 'ACTIVO' END as estado,
        to_char(e.fecha_ingreso, 'YYYY-MM-DD') as fecha_ingreso
      FROM empleados e
      LEFT JOIN cargos c ON c.uuid = e.cargo_uuid
      LEFT JOIN areas ar ON ar.uuid = c.area_uuid
      LEFT JOIN departamentos dep ON dep.uuid = ar.departamento_uuid
      LEFT JOIN salas s ON s.uuid = dep.sala_uuid
      WHERE (e.is_deleted = false OR e.is_deleted IS NULL)
        AND (s.grupo_uuid IS NULL OR s.grupo_uuid != '55d65e8b-09b2-4164-8491-efbdd50433b6'::uuid)
        ${salaCond}
      ORDER BY e.nombre ASC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getPersonalNominaModel:', err.message);
    return [];
  }
}

export async function getConceptosNominaModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, codigo, nombre, tipo, formula,
        gravable_ivss, gravable_faov
      FROM erp_nomina_conceptos
      WHERE is_deleted = false
      ORDER BY codigo ASC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getConceptosNominaModel:', err.message);
    return [];
  }
}

export async function getPeriodosNominaModel() {
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT 
        uuid, nombre, 
        to_char(fecha_desde, 'YYYY-MM-DD') as desde,
        to_char(fecha_hasta, 'YYYY-MM-DD') as hasta,
        tipo_frecuencia, estado,
        tasa_bcv::numeric as tasa_bcv,
        total_asignaciones_usd::numeric as total_asignaciones_usd,
        total_deducciones_usd::numeric as total_deducciones_usd,
        total_neto_usd::numeric as total_neto_usd
      FROM erp_nomina_periodos
      WHERE is_deleted = false
      ORDER BY fecha_desde DESC;
    `;
    return rows;
  } catch (err) {
    console.error('Error getPeriodosNominaModel:', err.message);
    return [];
  }
}

export async function aprobarPeriodoNominaModel(periodoUuid) {
  if (!sql || !isUuid(periodoUuid)) return null;
  const [updated] = await sql`
    UPDATE erp_nomina_periodos
    SET estado = 'APROBADA', updated_at = NOW()
    WHERE uuid = ${periodoUuid}
    RETURNING *;
  `;

  if (updated) {
    // --- FASE 3: GENERACIÓN AUTOMÁTICA DE ASIENTO CONTABLE DE NÓMINA (LOTTT) ---
    try {
      const asntUuid = randomUUID();
      const [{ asntCount }] = await sql`SELECT count(*)::int as asntCount FROM erp_asientos_contables;`;
      const asntNro = `AS-2026-${String(asntCount + 44).padStart(4, '0')}`;
      const glosaNomina = `Provisión y causación de Nómina: ${updated.nombre} (${updated.fecha_desde} al ${updated.fecha_hasta})`;

      let asigUsd = Number(updated.total_asignaciones_usd) || 0;
      let dedUsd = Number(updated.total_deducciones_usd) || 0;
      let netoUsd = Number(updated.total_neto_usd) || 0;

      // Si los montos vienen en 0 en la fila del período, los calculamos desde los empleados activos
      if (asigUsd <= 0) {
        const empRows = await sql`
          SELECT 
            uuid, cedula, nombre, nombre as nombres, 
            450.00::numeric as sueldo_base,
            'Banesco' as banco,
            '0134-0192-38-4920192837' as nro_cuenta
          FROM empleados
          WHERE is_deleted = false OR is_deleted IS NULL;
        `;

        let sumAsig = 0;
        let sumDed = 0;

        for (const emp of empRows) {
          const sBase = Number(emp.sueldo_base) || 450;
          const sQuincena = Number((sBase / 2).toFixed(2));
          const cestaQuincena = 20.00;
          const totalAsigEmp = sQuincena + cestaQuincena;
          const dedEmp = Number((sQuincena * 0.05).toFixed(2)); // 4% IVSS + 1% FAOV
          const netoEmp = totalAsigEmp - dedEmp;
          const netoVes = Number((netoEmp * (Number(updated.tasa_bcv) || 62.50)).toFixed(2));

          sumAsig += totalAsigEmp;
          sumDed += dedEmp;

          // Generar recibo individual de pago
          await sql`
            INSERT INTO erp_nomina_recibos (
              uuid, periodo_uuid, empleado_uuid, sueldo_base_usd, total_asignaciones_usd,
              total_deducciones_usd, neto_pagar_usd, neto_pagar_ves, banco, nro_cuenta
            ) VALUES (
              ${randomUUID()}, ${periodoUuid}, ${emp.uuid}, ${sBase}, ${totalAsigEmp},
              ${dedEmp}, ${netoEmp}, ${netoVes}, ${emp.banco}, ${emp.nro_cuenta}
            )
            ON CONFLICT (uuid) DO NOTHING;
          `;
        }

        asigUsd = Number(sumAsig.toFixed(2));
        dedUsd = Number(sumDed.toFixed(2));
        netoUsd = Number((asigUsd - dedUsd).toFixed(2));

        await sql`
          UPDATE erp_nomina_periodos
          SET total_asignaciones_usd = ${asigUsd},
              total_deducciones_usd = ${dedUsd},
              total_neto_usd = ${netoUsd}
          WHERE uuid = ${periodoUuid};
        `;
      }

      const fecha = updated.fecha_hasta ? String(updated.fecha_hasta).split('T')[0] : new Date().toISOString().split('T')[0];

      // Insertar Asiento Contable
      await sql`
        INSERT INTO erp_asientos_contables (
          uuid, nro_comprobante, fecha, glosa, tipo, estado, total_debe_usd, total_haber_usd
        ) VALUES (
          ${asntUuid}, ${asntNro}, ${fecha}, ${glosaNomina}, 'DIARIO', 'ASENTADO', ${asigUsd}, ${asigUsd}
        );
      `;

      // 1. Debe: Gasto de Sueldos y Salarios Personal (5.1.1.01)
      const [gastoRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '5.1.1.01' LIMIT 1;`;
      if (gastoRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${gastoRow.uuid}, ${asigUsd}, 0.00, ${updated.nombre});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${asigUsd}, updated_at = NOW() WHERE uuid = ${gastoRow.uuid};`;
      }

      // 2. Haber: Sueldos y Salarios por Pagar (2.1.3.01)
      const [pasivoRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.3.01' LIMIT 1;`;
      if (pasivoRow) {
        await sql`
          INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
          VALUES (${randomUUID()}, ${asntUuid}, ${pasivoRow.uuid}, 0.00, ${netoUsd}, ${updated.nombre});
        `;
        await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${netoUsd}, updated_at = NOW() WHERE uuid = ${pasivoRow.uuid};`;
      }

      // 3. Haber: Retenciones de Ley por Enterar (2.1.2.02)
      if (dedUsd > 0) {
        const [retRow] = await sql`SELECT uuid FROM erp_plan_cuentas WHERE codigo = '2.1.2.02' LIMIT 1;`;
        if (retRow) {
          await sql`
            INSERT INTO erp_asientos_detalles (uuid, asiento_uuid, cuenta_uuid, debe, haber, referencia)
            VALUES (${randomUUID()}, ${asntUuid}, ${retRow.uuid}, 0.00, ${dedUsd}, 'RET-IVSS-FAOV');
          `;
          await sql`UPDATE erp_plan_cuentas SET saldo = saldo + ${dedUsd}, updated_at = NOW() WHERE uuid = ${retRow.uuid};`;
        }
      }
    } catch (errAsnt) {
      console.warn('Advertencia generación automática asiento nómina:', errAsnt.message);
    }
  }

  return updated;
}

function formatFechaYMD(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  if (s.includes('T')) return s.split('T')[0];
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  } catch (e) {}
  return s.slice(0, 10);
}

export async function getCortesParaNominaModel(options = {}) {
  try {
    const res = await getCortesModel({
      limit: 100,
      userSalaIds: options.userSalaIds,
      salaIds: options.salaId ? [options.salaId] : []
    });
    const rows = res?.data || res?.rows || [];
    return rows.map(r => ({
      ...r,
      fecha_desde: formatFechaYMD(r.fecha_desde),
      fecha_hasta: formatFechaYMD(r.fecha_hasta),
    }));
  } catch (err) {
    console.error('Error getCortesParaNominaModel:', err.message);
    return [];
  }
}

export async function getCorteDetalleParaNominaModel(corteUuid) {
  try {
    const res = await getCorteByIdModel(corteUuid);
    const corte = res?.data || res;
    if (!corte) return null;

    let snapshotData = corte.data || {};
    if (typeof snapshotData === 'string') {
      try { snapshotData = JSON.parse(snapshotData); } catch (e) { snapshotData = {}; }
    }

    let rawEmpleados = snapshotData.empleados || [];
    if ((!rawEmpleados || rawEmpleados.length === 0) && snapshotData.reportData) {
      if (Array.isArray(snapshotData.reportData.empleados)) {
        rawEmpleados = snapshotData.reportData.empleados;
      } else if (Array.isArray(snapshotData.reportData.salas)) {
        rawEmpleados = [];
        snapshotData.reportData.salas.forEach(s => {
          (s.departamentos || []).forEach(d => {
            (d.empleados || []).forEach(emp => {
              rawEmpleados.push({
                ...emp,
                sala_nombre: s.nombre || s.sala_nombre,
                sala_id: s.id || s.uuid,
                departamento_nombre: d.nombre || d.departamento_nombre
              });
            });
          });
        });
      }
    }

    // Traer empleados reales de PostgreSQL para cruzar sueldos, cargos y cuentas bancarias
    let dbEmpleados = [];
    if (sql) {
      dbEmpleados = await sql`
        SELECT 
          e.uuid, e.cedula, e.nombre,
          COALESCE(c.nombre, 'Empleado Operativo') as cargo_nombre,
          COALESCE(dep.nombre, 'Operaciones de Sala') as departamento_nombre,
          COALESCE(s.nombre, 'Principal') as sala_nombre,
          COALESCE(s.uuid, dep.sala_uuid) as sala_uuid
        FROM empleados e
        LEFT JOIN cargos c ON c.uuid = e.cargo_uuid
        LEFT JOIN areas ar ON ar.uuid = c.area_uuid
        LEFT JOIN departamentos dep ON dep.uuid = ar.departamento_uuid
        LEFT JOIN salas s ON s.uuid = dep.sala_uuid
        WHERE (e.is_deleted = false OR e.is_deleted IS NULL)
          AND (s.grupo_uuid IS NULL OR s.grupo_uuid != '55d65e8b-09b2-4164-8491-efbdd50433b6'::uuid);
      `;
    }

    const dbMap = new Map();
    dbEmpleados.forEach(emp => {
      if (emp.uuid) dbMap.set(String(emp.uuid), emp);
      if (emp.cedula) {
        const cleanCed = String(emp.cedula).replace(/[^0-9]/g, '');
        if (cleanCed) dbMap.set(cleanCed, emp);
      }
    });

    // Mapear cada empleado del corte calculando nómina real según LOTTT
    const empleadosProcesados = rawEmpleados.map(emp => {
      const cleanCedula = String(emp.cedula || '').replace(/[^0-9]/g, '');
      const dbEmp = (emp.uuid && dbMap.get(String(emp.uuid))) || (cleanCedula && dbMap.get(cleanCedula)) || {};

      let diasTrabajados = 0;
      if (Array.isArray(emp.dias) && emp.dias.length > 0) {
        emp.dias.forEach(d => {
          if (d.resultadoStr === 'ASISTENCIA' || d.resultadoStr === 'PRESENTE' || (d.trabajadosMins && d.trabajadosMins > 0)) {
            diasTrabajados++;
          }
        });
      } else {
        diasTrabajados = Number(emp.diasTrabajados || emp.dias_trabajados || 15);
      }
      if (diasTrabajados === 0 && (!emp.dias || emp.dias.length === 0)) {
        diasTrabajados = 15;
      }

      const sueldoMensual = Number(emp.sueldo_base || 450.00);
      const sueldoQuincenal = Number((sueldoMensual / 2).toFixed(2));
      const cestaticket = 20.00; // 40 USD / 2 quincenal
      const horasExtrasHrs = Number(emp.horasExtras || emp.horas_extras || 0);
      const valorHora = (sueldoMensual / 30 / 8) * 1.5;
      const horasExtrasMonto = Number((horasExtrasHrs * valorHora).toFixed(2));
      const bonos = Number(emp.bono || 0);

      const totalAsig = Number((sueldoQuincenal + cestaticket + horasExtrasMonto + bonos).toFixed(2));

      // Deducciones de ley venezolana: IVSS (4%) + FAOV (1%)
      const dedIvss = Number(((sueldoMensual * 12 / 52) * 0.04 * 2).toFixed(2));
      const dedFaov = Number((sueldoQuincenal * 0.01).toFixed(2));
      const anticipos = Number(emp.anticipos || 0);
      const totalDed = Number((dedIvss + dedFaov + anticipos).toFixed(2));

      const netoUsd = Number(Math.max(0, totalAsig - totalDed).toFixed(2));

      const finalNombre = emp.nombre || emp.nombres || dbEmp.nombre || 'Empleado';
      const finalCedula = emp.cedula || dbEmp.cedula || 'V-00000000';
      const finalCargo = emp.cargo || dbEmp.cargo_nombre || 'Operador';
      const finalDep = emp.departamento_nombre || emp.departamento || dbEmp.departamento_nombre || 'Sala';
      const finalSala = emp.sala_nombre || dbEmp.sala_nombre || (corte.salas_nombres?.[0] || 'Principal');

      return {
        uuid: emp.uuid || dbEmp.uuid || (emp.id ? String(emp.id) : randomUUID()),
        cedula: finalCedula,
        nombre: finalNombre,
        nombres: finalNombre,
        cargo: finalCargo,
        departamento: finalDep,
        sala_nombre: finalSala,
        sala_uuid: emp.sala_uuid || dbEmp.sala_uuid || null,
        dias_trabajados: diasTrabajados,
        horas_extras_hrs: horasExtrasHrs,
        horas_extras_monto: horasExtrasMonto,
        sueldo_mensual: sueldoMensual,
        sueldo_quincenal: sueldoQuincenal,
        sueldoQuincena: sueldoQuincenal,
        cestaticket: cestaticket,
        cestaQuincena: cestaticket,
        bonos: bonos,
        bonoAdicional: bonos,
        total_asignaciones: totalAsig,
        totalAsignaciones: totalAsig,
        deduccion_ivss: dedIvss,
        dedIvss: dedIvss,
        deduccion_faov: dedFaov,
        dedFaov: dedFaov,
        anticipos: anticipos,
        total_deducciones: totalDed,
        totalDeducciones: totalDed,
        neto_pagar_usd: netoUsd,
        netoPagarUsd: netoUsd,
        banco: 'Banesco',
        nro_cuenta: '0134-0192-38-4920192837'
      };
    });

    const cleanDesde = formatFechaYMD(corte.fecha_desde);
    const cleanHasta = formatFechaYMD(corte.fecha_hasta);

    return {
      corte_uuid: corte.uuid,
      corte_id: corte.id,
      fecha_desde: cleanDesde,
      fecha_hasta: cleanHasta,
      salas_uuids: corte.salas_uuids,
      salas_nombres: corte.salas_nombres,
      total_empleados: empleadosProcesados.length,
      empleados: empleadosProcesados
    };
  } catch (err) {
    console.error('Error getCorteDetalleParaNominaModel:', err.message);
    return null;
  }
}
