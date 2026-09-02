-- 1. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre_apellido VARCHAR(255),
    usuario VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Grupo de Salas (Indica el tipo/categoría de cada sala)
CREATE TABLE IF NOT EXISTS grupo_salas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Salas (Con relación hacia grupo_salas)
CREATE TABLE IF NOT EXISTS salas (
    id SERIAL PRIMARY KEY,
    grupo_id INTEGER REFERENCES grupo_salas(id) ON DELETE SET NULL,
    nombre VARCHAR(255) NOT NULL,
    nombre_comercial VARCHAR(255),
    rif VARCHAR(50),
    ubicacion TEXT,
    correo VARCHAR(100),
    telefono VARCHAR(50),
    logo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla Relacional User - Salas
CREATE TABLE IF NOT EXISTS user_salas (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabla de Páginas (Categorías Principales)
CREATE TABLE IF NOT EXISTS paginas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabla de Módulos (Sub-vistas pertenecientes a una Página)
CREATE TABLE IF NOT EXISTS modulos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    icono VARCHAR(50) DEFAULT 'settings',
    ruta VARCHAR(255) NOT NULL,
    page_id INTEGER REFERENCES paginas(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabla de Permisos por Defecto
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tabla de Permisos de Usuario por Módulo (user_module_permissions)
CREATE TABLE IF NOT EXISTS user_module_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    module_id INTEGER REFERENCES modulos(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Tabla de Dispositivos (Control de Marcaje y Acceso)
CREATE TABLE IF NOT EXISTS dispositivos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
    ip_local VARCHAR(50),
    ip_remota VARCHAR(50),
    ip_panel VARCHAR(50),
    usuario VARCHAR(50),
    clave VARCHAR(100),
    marcaje_inicio TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    marcaje_fin TIMESTAMP WITH TIME ZONE
);

-- 10. Tabla de Registros de Marcajes Biométricos (attlogs)
CREATE TABLE IF NOT EXISTS attlogs (
    id SERIAL PRIMARY KEY,
    dispositivo_id INTEGER REFERENCES dispositivos(id) ON DELETE CASCADE,
    employee_no VARCHAR(100) NOT NULL,
    event_time TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    nombre VARCHAR(255),
    attendanceStatus VARCHAR(100),
    CONSTRAINT uk_attlog_record UNIQUE (dispositivo_id, employee_no, event_time)
);

CREATE INDEX IF NOT EXISTS idx_attlogs_dispositivo ON attlogs(dispositivo_id);
CREATE INDEX IF NOT EXISTS idx_attlogs_employee ON attlogs(employee_no);
CREATE INDEX IF NOT EXISTS idx_attlogs_event_time ON attlogs(event_time);

-- Seed Data Inicial

-- Insertar Grupos de Salas (Tipo de Instalación: SALA o GALPÓN)
INSERT INTO grupo_salas (id, nombre, descripcion) VALUES
(1, 'SALA', 'Sala de juego / Casino'),
(2, 'GALPÓN', 'Galpón / Depósito de almacenamiento')
ON CONFLICT (id) DO NOTHING;

-- Insertar Permisos
INSERT INTO permissions (id, nombre) VALUES
(1, 'AGREGAR'),
(2, 'REPORTE'),
(3, 'EDITAR'),
(4, 'BORRAR'),
(5, 'VER')
ON CONFLICT (id) DO NOTHING;

-- Insertar Usuario Inicial
INSERT INTO usuarios (id, nombre_apellido, usuario, password) VALUES
(1, 'Wilinthon Carriedo', 'wilinthon', '123456')
ON CONFLICT (id) DO NOTHING;

-- Insertar Salas Iniciales (Asociadas a grupo_salas)
INSERT INTO salas (id, grupo_id, nombre, nombre_comercial, rif, ubicacion, correo, telefono) VALUES
(1, 1, 'Monagas Royal Casino', 'Monagas Royal Casino, C.A.', 'J-50354350-7', 'Av Alirio Ugarte PelayoInstalaciones del Hotel StaufferMaturin Estado Monagas.', 'rrhh@monagasroyalcasino.com', '0412-019.37.73'),
(2, 1, 'Roraima', 'Casino Roraima Inn', 'J-30606591-6', 'Av Monseñor Zabaleta Edif Roraima Inn Piso 0 al 3 Local Roraima Inn Sector Castillito Puerto Ordaz Guayana Bolivar Zona Postal 8050', 'rrhhcasinororaima2023@gmail.com', '0424-968.86.12'),
(3, 1, 'Gan Casino PLC', 'Gan Casino PLC', 'J-12345678-0', 'Puerto La Cruz', 'contacto@gancasino.com', '0281-265.43.21'),
(4, 1, 'Charaima', 'Charaima', 'J-87654321-9', 'Charaima', 'info@charaima.com', '0295-888.77.66'),
(5, 1, 'Casino Caribe Plaza', 'Casino Caribe Plaza', 'J-99887766-5', 'Caribe Plaza', 'contacto@caribeplaza.com', '0295-999.00.11'),
(6, 1, 'Gran Casino El Marques', 'Gran Casino El Marques', 'J-11223344-8', 'El Marqués, Caracas', 'rrhh@marquescasino.com', '0212-234.56.78'),
(7, 1, 'Gran Casino San Cristobal', 'Gran Casino San Cristobal', 'J-55667788-3', 'San Cristóbal, Táchira', 'contacto@sancristobal.com', '0276-345.67.89'),
(8, 1, 'Casino Ciudad Bolivar', 'Casino Ciudad Bolivar', 'J-44332211-0', 'Ciudad Bolivar', 'contacto@ciudadbolivar.com', '0285-654.32.10')
ON CONFLICT (id) DO NOTHING;

-- Relacionar Usuario 1 con Salas 1..8
INSERT INTO user_salas (user_id, sala_id) VALUES
(1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8)
ON CONFLICT DO NOTHING;

-- Insertar Páginas Iniciales
INSERT INTO paginas (id, nombre) VALUES
(1, 'CECOM'),
(2, 'RRHH'),
(3, 'MAQUINAS'),
(7, 'MESAS EN VIVO')
ON CONFLICT (id) DO NOTHING;

-- Insertar Módulos de las Páginas
INSERT INTO modulos (id, nombre, icono, ruta, page_id) VALUES
-- Módulos de CECOM (page_id = 1)
(5, 'Libro', 'settings', '/cecom/libro', 1),
(32, 'Llaves', 'settings', '/cecom/llaves', 1),
(33, 'Llaves Borradas', 'settings', '/cecom/llaves-borradas', 1),
-- Módulos de RRHH (page_id = 2)
(1, 'Fotos Globales', 'settings', '/rrhh/fotos-globales', 2),
(2, 'Empleados', 'settings', '/rrhh/empleados', 2),
(3, 'Cargos', 'settings', '/rrhh/cargos', 2),
(4, 'Ciclo de Horario', 'settings', '/rrhh/ciclo-de-horario', 2),
(24, 'Areas', 'settings', '/rrhh/areas', 2),
(25, 'Departamentos', 'settings', '/rrhh/departamentos', 2),
(26, 'Reportes', 'settings', '/rrhh/reportes', 2),
(27, 'Desincorporados', 'settings', '/rrhh/desincorporados', 2),
(28, 'Carnet', 'settings', '/rrhh/carnet', 2),
(29, 'Horarios', 'settings', '/rrhh/horarios', 2),
(30, 'Cumpleaños', 'settings', '/rrhh/cumpleanos', 2),
(31, 'Feriados', 'settings', '/rrhh/feriados', 2),
-- Módulos de MAQUINAS (page_id = 3)
(23, 'Máquinas', 'settings', '/maquinas/maquinas', 3),
(14, 'Estados', 'settings', '/maquinas/estados', 3),
(15, 'Sociedades', 'settings', '/maquinas/sociedades', 3),
(16, 'Valores', 'settings', '/maquinas/valores', 3),
(17, 'Juegos', 'settings', '/maquinas/juegos', 3),
(18, 'Marcas', 'settings', '/maquinas/marcas', 3),
(19, 'Modelos', 'settings', '/maquinas/modelos', 3),
(20, 'Tipos', 'settings', '/maquinas/tipos', 3),
(21, 'Modos', 'settings', '/maquinas/modos', 3),
(22, 'Legal', 'settings', '/maquinas/legal', 3),
-- Módulos de MESAS EN VIVO (page_id = 7)
(12, 'Mesas', 'settings', '/mesas-en-vivo/mesas', 7),
(34, 'Juegos', 'settings', '/mesas-en-vivo/juegos', 7),
(35, 'Mesas Borradas', 'settings', '/mesas-en-vivo/mesas-borradas', 7)
ON CONFLICT (id) DO NOTHING;

-- Asignar Permisos Iniciales al Usuario 1 (wilinthon) en todos los módulos activos
INSERT INTO user_module_permissions (user_id, module_id, permission_id) VALUES
-- Módulos de CECOM (5, 32, 33) y MESAS EN VIVO (12, 34, 35)
(1, 5, 5), (1, 5, 1), (1, 5, 3), (1, 5, 4), (1, 5, 2),
(1, 32, 5), (1, 32, 1), (1, 32, 3), (1, 32, 4), (1, 32, 2),
(1, 33, 5), (1, 33, 1), (1, 33, 3), (1, 33, 4), (1, 33, 2),
(1, 12, 5), (1, 12, 1), (1, 12, 3), (1, 12, 4), (1, 12, 2),
(1, 34, 5), (1, 34, 1), (1, 34, 3), (1, 34, 4), (1, 34, 2),
(1, 35, 5), (1, 35, 1), (1, 35, 3), (1, 35, 4), (1, 35, 2),
-- Módulos de RRHH (1..4, 24..31)
(1, 1, 5), (1, 1, 1), (1, 1, 3), (1, 1, 4), (1, 1, 2),
(1, 2, 5), (1, 2, 1), (1, 2, 3), (1, 2, 4), (1, 2, 2),
(1, 3, 5), (1, 3, 1), (1, 3, 3), (1, 3, 4), (1, 3, 2),
(1, 4, 5), (1, 4, 1), (1, 4, 3), (1, 4, 4), (1, 4, 2),
(1, 24, 5), (1, 24, 1), (1, 24, 3), (1, 24, 4), (1, 24, 2),
(1, 25, 5), (1, 25, 1), (1, 25, 3), (1, 25, 4), (1, 25, 2),
(1, 26, 5), (1, 26, 1), (1, 26, 3), (1, 26, 4), (1, 26, 2),
(1, 27, 5), (1, 27, 1), (1, 27, 3), (1, 27, 4), (1, 27, 2),
(1, 28, 5), (1, 28, 1), (1, 28, 3), (1, 28, 4), (1, 28, 2),
(1, 29, 5), (1, 29, 1), (1, 29, 3), (1, 29, 4), (1, 29, 2),
(1, 30, 5), (1, 30, 1), (1, 30, 3), (1, 30, 4), (1, 30, 2),
(1, 31, 5), (1, 31, 1), (1, 31, 3), (1, 31, 4), (1, 31, 2),
-- Módulos de MAQUINAS (23, 14..22)
(1, 23, 5), (1, 23, 1), (1, 23, 3), (1, 23, 4), (1, 23, 2),
(1, 14, 5), (1, 14, 1), (1, 14, 3), (1, 14, 4), (1, 14, 2),
(1, 15, 5), (1, 15, 1), (1, 15, 3), (1, 15, 4), (1, 15, 2),
(1, 16, 5), (1, 16, 1), (1, 16, 3), (1, 16, 4), (1, 16, 2),
(1, 17, 5), (1, 17, 1), (1, 17, 3), (1, 17, 4), (1, 17, 2),
(1, 18, 5), (1, 18, 1), (1, 18, 3), (1, 18, 4), (1, 18, 2),
(1, 19, 5), (1, 19, 1), (1, 19, 3), (1, 19, 4), (1, 19, 2),
(1, 20, 5), (1, 20, 1), (1, 20, 3), (1, 20, 4), (1, 20, 2),
(1, 21, 5), (1, 21, 1), (1, 21, 3), (1, 21, 4), (1, 21, 2),
(1, 22, 5), (1, 22, 1), (1, 22, 3), (1, 22, 4), (1, 22, 2)
ON CONFLICT DO NOTHING;

-- Insertar Dispositivos Iniciales (17 filas exactas de la base de datos)
INSERT INTO dispositivos (id, nombre, sala_id, ip_local, ip_remota, ip_panel, usuario, clave, marcaje_inicio, marcaje_fin) VALUES
(3, 'Marcaje Personal ( Monagas )', 1, NULL, '186.167.73.66:8027', NULL, 'admin', 'S0p0rt3S0p0rt3', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(4, 'Marcaje Personal ( Charaima )', 4, NULL, '170.81.146.200:8069', NULL, 'admin', 'S0p0rt3S0p0rt3', '2025-01-01 00:00:00', '2030-10-06 23:59:59'),
(18, 'Marcaje Personal ( Marques )', 6, NULL, '190.153.101.14:8046', NULL, 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(19, 'Marcaje Personal ( PLC )', 3, NULL, '186.167.71.162:8061', NULL, 'admin', 'Cas1n01234', '2025-01-01 00:00:00', '2030-10-07 23:59:59'),
(21, 'Marcaje Personal ( SC )', 7, NULL, '190.6.52.103:8039', NULL, 'admin', 'Raijenny2011*', '2025-01-01 00:00:00', '2030-10-09 23:59:59'),
(24, 'Puerta Cecom ( Marques )', 6, '190.153.101.14:8070', '190.153.101.14:8087', '190.153.101.14:8090', 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(25, 'Puerta Boveda ( Marques )', 6, '190.153.101.14:8050', '190.153.101.14:8035', '190.153.101.14:8091', 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(26, 'Puerta Caja ( Marques )', 6, '190.153.101.14:8050', '190.153.101.14:8036', '190.153.101.14:8092', 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(31, 'Marcaje CECOM ( Roraima )', 2, '192.168.100.113', '190.72.102.210:8091', NULL, 'admin', 'Jjnc0412', '2025-01-01 00:00:00', '2030-11-30 23:59:59'),
(32, 'Puerta Arco ( Marques )', 6, '190.153.101.14:8085', '190.153.101.14:8008', '190.153.101.14:8093', 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(34, 'Puerta Pasillo ( Marques )', 6, '190.153.101.14:8085', '190.153.101.14:8009', '190.153.101.14:8094', 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(35, 'Puerta KFC ( Marques )', 6, '190.153.101.14:8081', '190.153.101.14:8037', '190.153.101.14:8095', 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(36, 'Puerta Servidores ( Marques )', 6, '190.153.101.14:8070', '190.153.101.14:8088', NULL, 'admin', 'Sigma2025', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(37, 'Puerta Cecom ( SC )', 7, NULL, '190.6.52.103:8040', NULL, 'admin', 'Raijenny2011*', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(38, 'Marcaje Secundario ( SC )', 7, NULL, '190.6.52.103:8041', NULL, 'admin', 'Raijenny2011*', '2025-01-01 00:00:00', '2030-12-31 23:59:59'),
(39, 'Marcaje Personal ( Roraima )', 2, '192.168.3.174', '190.72.102.210:8030', NULL, 'admin', 'Jjnc0412', '2026-01-01 00:00:00', '2031-01-31 23:59:59'),
(40, 'Marcaje Personal ( Plaza )', 5, NULL, '190.72.102.210:8031', NULL, 'admin', 'Jjnc0412', '2026-06-30 00:00:00', '2031-06-30 23:59:59')
ON CONFLICT (id) DO NOTHING;
