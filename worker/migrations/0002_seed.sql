-- Categories
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Ingreso', 0, 'fijo', '#639922', 0);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Alquiler', 18000, 'fijo', '#639922', 1);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Supermercado', 12000, 'variable', '#534AB7', 2);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Transporte', 6000, 'variable', '#1D9E75', 3);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Suscripciones', 5000, 'fijo', '#D85A30', 4);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Restaurantes', 8000, 'variable', '#378ADD', 5);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Servicios', 7000, 'fijo', '#BA7517', 6);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Salud', 4000, 'variable', '#E24B4A', 7);
INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order) VALUES ('Otros', 5000, 'variable', '#888780', 8);

-- Accounts
INSERT OR IGNORE INTO accounts (id, name, currency, balance) VALUES ('brou_uyu', 'BROU Caja de Ahorro', 'UYU', 48320);
INSERT OR IGNORE INTO accounts (id, name, currency, balance) VALUES ('visa_gold', 'Visa Gold BROU', 'UYU', -12500);
INSERT OR IGNORE INTO accounts (id, name, currency, balance) VALUES ('brou_usd', 'BROU USD', 'USD', 1240);
INSERT OR IGNORE INTO accounts (id, name, currency, balance) VALUES ('itau_uyu', 'Itau Cuenta Corriente', 'UYU', 22100);

-- Installments
INSERT OR IGNORE INTO installments (id, descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month)
  VALUES (1, 'Heladera Samsung', 45000, 12, 4, 3750, 'visa_gold', '2025-12');
INSERT OR IGNORE INTO installments (id, descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month)
  VALUES (2, 'Notebook Lenovo', 28000, 6, 2, 4667, 'visa_gold', '2026-02');
INSERT OR IGNORE INTO installments (id, descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month)
  VALUES (3, 'Aire acondicionado', 32000, 10, 7, 3200, 'itau_uyu', '2025-09');

-- Transactions March 2026
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-01','ALQUILER DEPTO MAR',-18000,'UYU',c.id,'brou_uyu',0,NULL,'h_alq_mar_01'
  FROM categories c WHERE c.name='Alquiler';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-02','ANTEL *DEB AUTOMATICO',-2890,'UYU',c.id,'brou_uyu',0,NULL,'h_antel_mar_02'
  FROM categories c WHERE c.name='Servicios';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-03','SPOTIFY PREMIUM',-490,'UYU',c.id,'visa_gold',0,NULL,'h_spo_mar_03'
  FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-03','NETFLIX.COM',-850,'UYU',c.id,'visa_gold',0,NULL,'h_net_mar_03'
  FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-04','TATA *POS 2281',-3420,'UYU',c.id,'visa_gold',0,NULL,'h_tata_mar_04'
  FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-05','TRANSFERENCIA RECIBIDA',65000,'UYU',c.id,'brou_uyu',0,NULL,'h_ing_mar_05'
  FROM categories c WHERE c.name='Ingreso';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-06','UBER *TRIP 8821',-320,'UYU',c.id,'brou_uyu',0,NULL,'h_uber_mar_06'
  FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-07','PEDIDOSYA *7732',-890,'UYU',c.id,'visa_gold',0,NULL,'h_pya_mar_07'
  FROM categories c WHERE c.name='Restaurantes';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-08','FARMASHOP *POS',-1250,'UYU',c.id,'visa_gold',0,NULL,'h_farm_mar_08'
  FROM categories c WHERE c.name='Salud';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-10','TATA *POS 2281',-2890,'UYU',c.id,'visa_gold',0,NULL,'h_tata_mar_10'
  FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-11','UTE *DEB AUTOMATICO',-3200,'UYU',c.id,'brou_uyu',0,NULL,'h_ute_mar_11'
  FROM categories c WHERE c.name='Servicios';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-12','PEDIDOSYA *1192',-750,'UYU',c.id,'visa_gold',0,NULL,'h_pya_mar_12'
  FROM categories c WHERE c.name='Restaurantes';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-13','STM RECARGA',-600,'UYU',c.id,'brou_uyu',0,NULL,'h_stm_mar_13'
  FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-14','CUOTA HELADERA 4/12',-3750,'UYU',c.id,'visa_gold',1,1,'h_hela_mar_14'
  FROM categories c WHERE c.name='Otros';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-14','CUOTA NOTEBOOK 2/6',-4667,'UYU',c.id,'visa_gold',1,2,'h_note_mar_14'
  FROM categories c WHERE c.name='Otros';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-15','CUOTA AIRE 7/10',-3200,'UYU',c.id,'itau_uyu',1,3,'h_aire_mar_15'
  FROM categories c WHERE c.name='Otros';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-16','DEVOTO *POS 1102',-4100,'UYU',c.id,'brou_uyu',0,NULL,'h_devoto_mar_16'
  FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  VALUES ('2026-03-18','POS COMPRA *4821',-2340,'UYU',NULL,'visa_gold',0,NULL,'h_pos_mar_18');
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-19','TRANSFERENCIA RECIBIDA',45000,'UYU',c.id,'itau_uyu',0,NULL,'h_ing_mar_19'
  FROM categories c WHERE c.name='Ingreso';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  VALUES ('2026-03-20','DEBITO AUTOMATICO SER',-1890,'UYU',NULL,'brou_uyu',0,NULL,'h_deb_mar_20');
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-21','PEDIDOSYA *7732',-890,'UYU',c.id,'visa_gold',0,NULL,'h_pya_mar_21'
  FROM categories c WHERE c.name='Restaurantes';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-22','UBER *TRIP 9031',-450,'UYU',c.id,'brou_uyu',0,NULL,'h_uber_mar_22'
  FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-23','ABITAB RECARGA',-350,'UYU',c.id,'brou_uyu',0,NULL,'h_abitab_mar_23'
  FROM categories c WHERE c.name='Otros';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-24','PAGO APPLE.COM',-199,'UYU',c.id,'visa_gold',0,NULL,'h_apple_mar_24'
  FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-03-25','SUELDO COMPLEMENTO',12000,'UYU',c.id,'itau_uyu',0,NULL,'h_sueldo2_mar_25'
  FROM categories c WHERE c.name='Ingreso';

-- Transactions February 2026
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-01','ALQUILER DEPTO FEB',-18000,'UYU',c.id,'brou_uyu',0,NULL,'h_alq_feb_01'
  FROM categories c WHERE c.name='Alquiler';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-03','ANTEL *DEB',-2890,'UYU',c.id,'brou_uyu',0,NULL,'h_antel_feb_03'
  FROM categories c WHERE c.name='Servicios';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-04','TATA *POS',-5200,'UYU',c.id,'visa_gold',0,NULL,'h_tata_feb_04'
  FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-05','SUELDO',62000,'UYU',c.id,'brou_uyu',0,NULL,'h_sueldo_feb_05'
  FROM categories c WHERE c.name='Ingreso';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-07','UBER',-280,'UYU',c.id,'brou_uyu',0,NULL,'h_uber_feb_07'
  FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-08','PEDIDOSYA',-670,'UYU',c.id,'visa_gold',0,NULL,'h_pya_feb_08'
  FROM categories c WHERE c.name='Restaurantes';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-10','SPOTIFY',-490,'UYU',c.id,'visa_gold',0,NULL,'h_spo_feb_10'
  FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-12','NETFLIX',-850,'UYU',c.id,'visa_gold',0,NULL,'h_net_feb_12'
  FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-14','UTE *DEB',-2950,'UYU',c.id,'brou_uyu',0,NULL,'h_ute_feb_14'
  FROM categories c WHERE c.name='Servicios';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-15','DEVOTO *POS',-3800,'UYU',c.id,'brou_uyu',0,NULL,'h_devoto_feb_15'
  FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-18','FARMASHOP',-980,'UYU',c.id,'visa_gold',0,NULL,'h_farm_feb_18'
  FROM categories c WHERE c.name='Salud';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-20','PEDIDOSYA',-520,'UYU',c.id,'visa_gold',0,NULL,'h_pya_feb_20'
  FROM categories c WHERE c.name='Restaurantes';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-22','STM RECARGA',-600,'UYU',c.id,'brou_uyu',0,NULL,'h_stm_feb_22'
  FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash)
  SELECT '2026-02-25','TRANSFERENCIA',40000,'UYU',c.id,'itau_uyu',0,NULL,'h_ing_feb_25'
  FROM categories c WHERE c.name='Ingreso';

-- Rules
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'PEDIDOSYA', c.id, 8 FROM categories c WHERE c.name='Restaurantes';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'UBER', c.id, 14 FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'SPOTIFY', c.id, 3 FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'NETFLIX', c.id, 3 FROM categories c WHERE c.name='Suscripciones';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'TATA', c.id, 6 FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'DEVOTO', c.id, 4 FROM categories c WHERE c.name='Supermercado';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'ANTEL', c.id, 5 FROM categories c WHERE c.name='Servicios';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'UTE', c.id, 5 FROM categories c WHERE c.name='Servicios';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'STM', c.id, 3 FROM categories c WHERE c.name='Transporte';
INSERT OR IGNORE INTO rules (pattern, category_id, match_count)
  SELECT 'FARMASHOP', c.id, 2 FROM categories c WHERE c.name='Salud';
