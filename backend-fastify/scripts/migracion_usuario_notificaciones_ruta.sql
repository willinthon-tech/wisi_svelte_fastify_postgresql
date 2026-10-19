-- Migración para añadir soporte de notificaciones por usuario y ruta por defecto
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS recibe_notificaciones BOOLEAN DEFAULT true;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ruta_defecto VARCHAR(255) DEFAULT '/dashboard';
UPDATE usuarios SET recibe_notificaciones = true WHERE recibe_notificaciones IS NULL;
UPDATE usuarios SET ruta_defecto = '/dashboard' WHERE ruta_defecto IS NULL OR TRIM(ruta_defecto) = '';
