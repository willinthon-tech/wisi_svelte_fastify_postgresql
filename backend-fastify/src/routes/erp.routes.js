import {
  getArticulos,
  saveArticulo,
  deleteArticulo,
  getProveedores,
  saveProveedor,
  getFacturasVentas,
  createFacturaVenta,
  anularFacturaVenta,
  getFacturasCompras,
  createFacturaCompra,
  getCxcCxp,
  getReporteFiscalSeniat,
  getPlanCuentas,
  saveCuenta,
  getCentrosCostos,
  getAsientos,
  createAsiento,
  getEstadosFinancieros,
  getPersonalNomina,
  getConceptosNomina,
  getPeriodosNomina,
  aprobarPeriodoNomina
} from '../controllers/erp.controller.js';

export async function erpRoutes(fastify, options) {
  // --- ADMINISTRATIVO ---
  fastify.get('/api/erp/articulos', getArticulos);
  fastify.post('/api/erp/articulos', saveArticulo);
  fastify.delete('/api/erp/articulos/:uuid', deleteArticulo);

  fastify.get('/api/erp/proveedores', getProveedores);
  fastify.post('/api/erp/proveedores', saveProveedor);

  fastify.get('/api/erp/facturas-ventas', getFacturasVentas);
  fastify.post('/api/erp/facturas-ventas', createFacturaVenta);
  fastify.post('/api/erp/facturas-ventas/:uuid/anular', anularFacturaVenta);

  fastify.get('/api/erp/facturas-compras', getFacturasCompras);
  fastify.post('/api/erp/facturas-compras', createFacturaCompra);
  fastify.get('/api/erp/cxc-cxp', getCxcCxp);
  fastify.get('/api/erp/reportes-fiscales', getReporteFiscalSeniat);

  // --- CONTABILIDAD ---
  fastify.get('/api/erp/plan-cuentas', getPlanCuentas);
  fastify.post('/api/erp/plan-cuentas', saveCuenta);

  fastify.get('/api/erp/centros-costos', getCentrosCostos);

  fastify.get('/api/erp/asientos', getAsientos);
  fastify.post('/api/erp/asientos', createAsiento);
  fastify.get('/api/erp/estados-financieros', getEstadosFinancieros);

  // --- NÓMINA (LOTTT) ---
  fastify.get('/api/erp/nomina/personal', getPersonalNomina);
  fastify.get('/api/erp/nomina/conceptos', getConceptosNomina);
  fastify.get('/api/erp/nomina/periodos', getPeriodosNomina);
  fastify.post('/api/erp/nomina/periodos/:uuid/aprobar', aprobarPeriodoNomina);
}
