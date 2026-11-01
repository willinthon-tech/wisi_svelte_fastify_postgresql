import {
  getArticulosModel,
  saveArticuloModel,
  deleteArticuloModel,
  getProveedoresModel,
  saveProveedorModel,
  getFacturasVentasModel,
  createFacturaVentaModel,
  anularFacturaVentaModel,
  getFacturasComprasModel,
  createFacturaCompraModel,
  getCxcCxpSummaryModel,
  getPlanCuentasModel,
  saveCuentaModel,
  getCentrosCostosModel,
  getAsientosModel,
  createAsientoModel,
  getPersonalNominaModel,
  getConceptosNominaModel,
  getPeriodosNominaModel,
  aprobarPeriodoNominaModel
} from '../models/erp.model.js';

// ============================================================================
// 1. CONTROLADORES ADMINISTRATIVO
// ============================================================================

export async function getArticulos(req, reply) {
  try {
    const data = await getArticulosModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function saveArticulo(req, reply) {
  try {
    const data = await saveArticuloModel(req.body || {});
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function deleteArticulo(req, reply) {
  try {
    const { uuid } = req.params;
    await deleteArticuloModel(uuid);
    return reply.send({ success: true, message: 'Artículo eliminado correctamente' });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getProveedores(req, reply) {
  try {
    const data = await getProveedoresModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function saveProveedor(req, reply) {
  try {
    const data = await saveProveedorModel(req.body || {});
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getFacturasVentas(req, reply) {
  try {
    const data = await getFacturasVentasModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function createFacturaVenta(req, reply) {
  try {
    const data = await createFacturaVentaModel(req.body || {});
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function anularFacturaVenta(req, reply) {
  try {
    const { uuid } = req.params;
    const data = await anularFacturaVentaModel(uuid);
    return reply.send({ success: true, data, message: 'Factura anulada con Nota de Crédito fiscal' });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getFacturasCompras(req, reply) {
  try {
    const data = await getFacturasComprasModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function createFacturaCompra(req, reply) {
  try {
    const data = await createFacturaCompraModel(req.body || {});
    return reply.send({ success: true, data, message: 'Factura de compra registrada y asiento generado' });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getCxcCxp(req, reply) {
  try {
    const data = await getCxcCxpSummaryModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

// ============================================================================
// 2. CONTROLADORES CONTABILIDAD
// ============================================================================

export async function getPlanCuentas(req, reply) {
  try {
    const data = await getPlanCuentasModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function saveCuenta(req, reply) {
  try {
    const data = await saveCuentaModel(req.body || {});
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getCentrosCostos(req, reply) {
  try {
    const data = await getCentrosCostosModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function getAsientos(req, reply) {
  try {
    const data = await getAsientosModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function createAsiento(req, reply) {
  try {
    const data = await createAsientoModel(req.body || {});
    return reply.send({ success: true, data, message: 'Comprobante de diario validado y asentado' });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}

// ============================================================================
// 3. CONTROLADORES NÓMINA (LOTTT)
// ============================================================================

export async function getPersonalNomina(req, reply) {
  try {
    const data = await getPersonalNominaModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function getConceptosNomina(req, reply) {
  try {
    const data = await getConceptosNominaModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function getPeriodosNomina(req, reply) {
  try {
    const data = await getPeriodosNominaModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.code(500).send({ success: false, message: err.message });
  }
}

export async function aprobarPeriodoNomina(req, reply) {
  try {
    const { uuid } = req.params;
    const data = await aprobarPeriodoNominaModel(uuid);
    return reply.send({ success: true, data, message: 'Nómina aprobada y cerrada oficialmente' });
  } catch (err) {
    return reply.code(400).send({ success: false, message: err.message });
  }
}
