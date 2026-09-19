-- ====================================================================
-- MIGRACIÓN / SCRIPT SQL DE SANEAMIENTO DE CATÁLOGO DE MÁQUINAS
-- Marcas, Modelos de Gabinetes y Juegos de Máquinas
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- 1. FUSIÓN Y NORMALIZACIÓN DE MARCAS
-- --------------------------------------------------------------------

-- 1.1 Williams (Fusión de William, Wms y Sg)
DO $$
DECLARE
    v_target UUID;
BEGIN
    SELECT uuid INTO v_target FROM marcas WHERE LOWER(TRIM(nombre)) = 'williams' LIMIT 1;
    IF v_target IS NULL THEN
        INSERT INTO marcas (uuid, nombre, created_at, updated_at) VALUES (gen_random_uuid(), 'Williams', NOW(), NOW()) RETURNING uuid INTO v_target;
    END IF;

    UPDATE modelos SET marca_uuid = v_target WHERE marca_uuid IN (SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) IN ('william', 'wms', 'sg') AND uuid != v_target);
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) IN ('william', 'wms', 'sg') AND uuid != v_target;
END $$;

-- 1.2 Alfastreet (Fusión de Alphastreet, Alfa Street y Ruleta Alfastreet)
DO $$
DECLARE
    v_target UUID;
BEGIN
    SELECT uuid INTO v_target FROM marcas WHERE LOWER(TRIM(nombre)) = 'alfastreet' LIMIT 1;
    IF v_target IS NULL THEN
        INSERT INTO marcas (uuid, nombre, created_at, updated_at) VALUES (gen_random_uuid(), 'Alfastreet', NOW(), NOW()) RETURNING uuid INTO v_target;
    END IF;

    UPDATE modelos SET marca_uuid = v_target WHERE marca_uuid IN (SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) IN ('alphastreet', 'alfa street', 'ruleta alfastreet') AND uuid != v_target);
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) IN ('alphastreet', 'alfa street', 'ruleta alfastreet') AND uuid != v_target;
END $$;

-- 1.3 Ainsworth (Fusión de Ainsworth Game T)
DO $$
DECLARE
    v_target UUID;
BEGIN
    SELECT uuid INTO v_target FROM marcas WHERE LOWER(TRIM(nombre)) = 'ainsworth' LIMIT 1;
    UPDATE modelos SET marca_uuid = v_target WHERE marca_uuid IN (SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = 'ainsworth game t');
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) = 'ainsworth game t';
END $$;

-- 1.4 Novomatic (Mover modelos de Austrian Gaming a Novomatic)
DO $$
DECLARE
    v_target UUID;
BEGIN
    SELECT uuid INTO v_target FROM marcas WHERE LOWER(TRIM(nombre)) = 'novomatic' LIMIT 1;
    UPDATE modelos SET marca_uuid = v_target WHERE marca_uuid IN (SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = 'austrian');
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) = 'austrian';
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) = 'fv640 f2'; -- Marca falsa eliminada
END $$;

-- 1.5 Konami (Mover modelos de Konami Kp3 a Konami)
DO $$
DECLARE
    v_target UUID;
BEGIN
    SELECT uuid INTO v_target FROM marcas WHERE LOWER(TRIM(nombre)) = 'konami' LIMIT 1;
    UPDATE modelos SET marca_uuid = v_target WHERE marca_uuid IN (SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = 'konami kp3');
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) = 'konami kp3';
END $$;

-- 1.6 Aristocrat (Mover modelos de Astro-aristocrat a Aristocrat)
DO $$
DECLARE
    v_target UUID;
BEGIN
    SELECT uuid INTO v_target FROM marcas WHERE LOWER(TRIM(nombre)) = 'aristocrat' LIMIT 1;
    UPDATE modelos SET marca_uuid = v_target WHERE marca_uuid IN (SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = 'astro-aristocrat');
    DELETE FROM marcas WHERE LOWER(TRIM(nombre)) = 'astro-aristocrat';
END $$;

-- --------------------------------------------------------------------
-- 2. FUNCIÓN HELPER TEMPORAL PARA FUSIONAR MODELOS DE FORMA SEGURA
-- --------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE merge_slot_model(p_brand_name TEXT, p_canonical_name TEXT, p_aliases TEXT[])
LANGUAGE plpgsql AS $$
DECLARE
    v_brand_uuid UUID;
    v_canon_uuid UUID;
    v_alias TEXT;
    v_dup RECORD;
BEGIN
    SELECT uuid INTO v_brand_uuid FROM marcas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(p_brand_name)) LIMIT 1;
    IF v_brand_uuid IS NULL THEN
        RETURN;
    END IF;

    SELECT uuid INTO v_canon_uuid FROM modelos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(p_canonical_name)) AND marca_uuid = v_brand_uuid LIMIT 1;
    IF v_canon_uuid IS NULL THEN
        INSERT INTO modelos (uuid, nombre, marca_uuid, created_at, updated_at)
        VALUES (gen_random_uuid(), p_canonical_name, v_brand_uuid, NOW(), NOW())
        RETURNING uuid INTO v_canon_uuid;
    ELSE
        UPDATE modelos SET nombre = p_canonical_name WHERE uuid = v_canon_uuid;
    END IF;

    FOREACH v_alias IN ARRAY p_aliases LOOP
        FOR v_dup IN SELECT uuid FROM modelos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(v_alias)) AND uuid != v_canon_uuid LOOP
            UPDATE maquinas SET modelo_uuid = v_canon_uuid WHERE modelo_uuid = v_dup.uuid;
            DELETE FROM modelos WHERE uuid = v_dup.uuid;
        END LOOP;
    END LOOP;
END;
$$;

-- Ejecutar fusiones de modelos Novomatic
CALL merge_slot_model('Novomatic', 'FV 680 CF2', ARRAY['fv680 cf2', 'fv 680 cf2', 'cf2680']);
CALL merge_slot_model('Novomatic', 'FV 610 CF2', ARRAY['fv 610 cf2', 'fv610 cf2', 'cf2610']);
CALL merge_slot_model('Novomatic', 'FV 623 CFD', ARRAY['fv 623 cfd', 'fv623 cfd', 'cf1 623', 'fv623cfd']);
CALL merge_slot_model('Novomatic', 'FV 626 CF2', ARRAY['fv 626 cf2', 'fv626 cf2', 'cf2626', '626', 'fv626 cf2p', 'fv626 f1']);
CALL merge_slot_model('Novomatic', 'FV 640 CF2', ARRAY['fv 640 cf2', 'fv640 cf2', 'fv640 f2', '640', 'cf640', 'fv-640']);
CALL merge_slot_model('Novomatic', 'FV 880 CF2', ARRAY['fv880 cf2', 'fv 880 cf2', 'fv880', '880', 'fv-880']);
CALL merge_slot_model('Novomatic', 'FV 622 CF', ARRAY['fv622cf']);
CALL merge_slot_model('Novomatic', 'FV 629', ARRAY['fv629']);
CALL merge_slot_model('Novomatic', 'Coolfire 1', ARRAY['coolfire1', 'coolfire1(china)']);
CALL merge_slot_model('Novomatic', 'Coolfire 2', ARRAY['coolfire2']);

-- Ejecutar fusiones de modelos Aristocrat
CALL merge_slot_model('Aristocrat', 'MK6 - MAV500', ARRAY['mk6', 'mav500', 'mk6 mav500']);
CALL merge_slot_model('Aristocrat', 'MK5 - MAV540', ARRAY['mk5 mav540']);
CALL merge_slot_model('Aristocrat', 'MK6 - MAV540', ARRAY['mk6 mav540']);
CALL merge_slot_model('Aristocrat', 'Viridian WS', ARRAY['viridian ws', 'viridian 1']);
CALL merge_slot_model('Aristocrat', 'Viridian', ARRAY['viridian']);
CALL merge_slot_model('Aristocrat', 'Helix', ARRAY['helix']);
CALL merge_slot_model('Aristocrat', 'Helix Link', ARRAY['helix link']);
CALL merge_slot_model('Aristocrat', 'Helix Slant', ARRAY['helix slant']);

-- Ejecutar fusiones de modelos Bally
CALL merge_slot_model('Bally', 'Alpha 1', ARRAY['alpha 1', 'ap-1', 'alpha1']);
CALL merge_slot_model('Bally', 'Alpha 1 V20/20', ARRAY['alpha 1 v20-20']);
CALL merge_slot_model('Bally', 'Alpha 2 V32 Wave', ARRAY['alpha 2 v32 wv', 'ah-1 (a2 v32 wave)', 'alpha2wv', 'wave']);
CALL merge_slot_model('Bally', 'Alpha 2 V32', ARRAY['alpha 2 v32', 'ap-1 v32-st', 'ap-v32st', 'alpha2b32', 'ap-1 v32 st', 'v32']);
CALL merge_slot_model('Bally', 'Alpha 2 V22/32', ARRAY['alpha 2 v22/v32']);
CALL merge_slot_model('Bally', 'AP-1 V222 ST', ARRAY['ap-1 v222 st', 'ap-v222st']);
CALL merge_slot_model('Bally', 'M9000', ARRAY['m9000', 'm9000-s3', 'm9000-2c3']);

-- Ejecutar fusiones de modelos IGT
CALL merge_slot_model('IGT', 'CrystalDual 1070121', ARRAY['1070121', '1070121c', 'c1070121']);
CALL merge_slot_model('IGT', 'C1070120', ARRAY['c1070120']);
CALL merge_slot_model('IGT', 'Crystal Dual', ARRAY['crystal dual']);
CALL merge_slot_model('IGT', 'GL20', ARRAY['gl20']);
CALL merge_slot_model('IGT', 'Neo', ARRAY['neo']);
CALL merge_slot_model('IGT', 'AVP', ARRAY['avp']);

-- Ejecutar fusiones de modelos Konami
CALL merge_slot_model('Konami', 'Podium KP3', ARRAY['podium kp3']);
CALL merge_slot_model('Konami', 'KP3', ARRAY['kp3', 'kp']);
CALL merge_slot_model('Konami', 'KGP2', ARRAY['kgp2', 'kgp 2/3 ubss', 'kgp 2.0 uvsn']);
CALL merge_slot_model('Konami', 'KP2', ARRAY['kp2']);
CALL merge_slot_model('Konami', 'Endeavour Series', ARRAY['endearvour series', 'tasman series i']);

-- Ejecutar fusiones de modelos Williams
CALL merge_slot_model('Williams', 'Blade', ARRAY['blade']);
CALL merge_slot_model('Williams', 'Bluebird 1 (BB1)', ARRAY['bb1', 'blue bird one', 'wms bb1']);
CALL merge_slot_model('Williams', 'Bluebird 2 (BB2)', ARRAY['bbu', 'bbxd slanto']);

-- Ejecutar fusiones de modelos Unidesa
CALL merge_slot_model('Unidesa', 'S400', ARRAY['s400', 'cirsa s400', 's400 px', 'cirsa s400 video ia']);
CALL merge_slot_model('Unidesa', 'S300', ARRAY['s300', '300 mg', 'cirsa serie 300 video dl']);

-- Ejecutar fusiones de modelos Alfastreet
CALL merge_slot_model('Alfastreet', 'MMPG', ARRAY['mmpg']);
CALL merge_slot_model('Alfastreet', 'R8M3', ARRAY['r8m3-23', 'r8m3']);
CALL merge_slot_model('Alfastreet', '8K-Top', ARRAY['8k-top']);
CALL merge_slot_model('Alfastreet', 'R8TS', ARRAY['r8ts']);

-- Eliminar procedimiento temporal de modelos
DROP PROCEDURE merge_slot_model(TEXT, TEXT, TEXT[]);

-- --------------------------------------------------------------------
-- 3. FUNCIÓN HELPER TEMPORAL PARA FUSIONAR JUEGOS DE FORMA SEGURA
-- --------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE merge_slot_game(p_canonical_name TEXT, p_aliases TEXT[])
LANGUAGE plpgsql AS $$
DECLARE
    v_canon_uuid UUID;
    v_alias TEXT;
    v_dup RECORD;
BEGIN
    SELECT uuid INTO v_canon_uuid FROM juegos_maquinas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(p_canonical_name)) LIMIT 1;
    IF v_canon_uuid IS NULL THEN
        INSERT INTO juegos_maquinas (uuid, nombre, created_at, updated_at)
        VALUES (gen_random_uuid(), p_canonical_name, NOW(), NOW())
        RETURNING uuid INTO v_canon_uuid;
    ELSE
        UPDATE juegos_maquinas SET nombre = p_canonical_name WHERE uuid = v_canon_uuid;
    END IF;

    FOREACH v_alias IN ARRAY p_aliases LOOP
        FOR v_dup IN SELECT uuid FROM juegos_maquinas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(v_alias)) AND uuid != v_canon_uuid LOOP
            UPDATE maquinas SET juego_uuid = v_canon_uuid WHERE juego_uuid = v_dup.uuid;
            DELETE FROM juegos_maquinas WHERE uuid = v_dup.uuid;
        END LOOP;
    END LOOP;
END;
$$;

CALL merge_slot_game('Cats, Hats & Bats', ARRAY['cats hats & bats', 'cats hats y bats', 'cats hats y more bats']);
CALL merge_slot_game('Hold Onto Your Hat', ARRAY['holdonto your hat']);
CALL merge_slot_game('Multi-Juego (Multigame)', ARRAY['multigame', 'multi game', 'multijuego', 'multi juego', 'multijuegos', 'multi juegos']);
CALL merge_slot_game('Multi Game Winner''s Choice', ARRAY['multigame winner''s choice']);
CALL merge_slot_game('Multi Win 1', ARRAY['multiwin 1']);
CALL merge_slot_game('Multi Win 2', ARRAY['multiwin 2']);
CALL merge_slot_game('Multi Win 3', ARRAY['multiwin 3']);
CALL merge_slot_game('Multi Win 8 Quad Shot', ARRAY['multiwin 8 quad shot']);
CALL merge_slot_game('Selexion Multi Game', ARRAY['selexion multigame', 'selexion multigames']);
CALL merge_slot_game('Timber Wolf', ARRAY['timberwolf']);
CALL merge_slot_game('Ultimate Fire Link By The Bay', ARRAY['ultimate firelink by the bay']);
CALL merge_slot_game('Ultimate Fire Link China Street', ARRAY['ultimate firelink china street']);
CALL merge_slot_game('Ultimate Fire Link Glacier Gold', ARRAY['ultimate firelink glacier gold']);
CALL merge_slot_game('Ultimate Fire Link Olvera Street', ARRAY['ultimate firelink olvera street']);
CALL merge_slot_game('Ultimate Fire Link Riverwalk', ARRAY['ultimate firelink river walk']);
CALL merge_slot_game('Ultimate Fire Link Rue Royale', ARRAY['ultimate firelink rue royale']);
CALL merge_slot_game('Buffalo', ARRAY['bufallo', 'bufalo']);
CALL merge_slot_game('50 Lions', ARRAY['50 leones']);
CALL merge_slot_game('5 Dragons', ARRAY['50 dragones']);
CALL merge_slot_game('Choy Sun Doa', ARRAY['choy sun dot']);
CALL merge_slot_game('Bengal Treasures', ARRAY['bengal treasure']);
CALL merge_slot_game('Thai Treasures', ARRAY['thai treasure']);
CALL merge_slot_game('Best Bet', ARRAY['best best']);

-- Eliminar procedimiento temporal de juegos
DROP PROCEDURE merge_slot_game(TEXT, TEXT[]);

-- --------------------------------------------------------------------
-- 4. VERIFICACIÓN FINAL
-- --------------------------------------------------------------------
SELECT 'MÁQUINAS RESTANTES' AS check_type, count(*)::int AS total FROM maquinas
UNION ALL
SELECT 'MARCAS CONSOLIDADAS', count(*)::int FROM marcas
UNION ALL
SELECT 'MODELOS CONSOLIDADOS', count(*)::int FROM modelos
UNION ALL
SELECT 'JUEGOS CONSOLIDADOS', count(*)::int FROM juegos_maquinas;

COMMIT;
