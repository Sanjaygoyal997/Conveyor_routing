-- Scenario data: one clean path plus one example of each gap.
INSERT INTO master.users VALUES (1);
INSERT INTO master.reason VALUES (0);
INSERT INTO master.recipe VALUES (10), (11), (12), (13), (14), (15), (16), (17);

INSERT INTO master.rim_master (id, name, isactive, rim_id, local_area_id) VALUES
    (1, '15', true, 1, 1),
    (2, '16', true, 2, 1),
    (3, '17', false, 3, 1),       -- inactive rim
    (4, '18 ', true, 4, 1),       -- untrimmed name
    (5, '19', true, 5, 1);        -- nothing runs 19

INSERT INTO master.material_size_lookup (material_id, rim_size, area_id) VALUES
    (100, '15', 1),               -- OK
    (101, '16', 1), (101, '15', 1), -- two allowed rims, both running -> OK
    (102, '17', 1),               -- only rim is inactive
    (103, '20', 1),               -- rim not in master
    (104, '19', 1),               -- no equipment running 19
    (105, '18', NULL),            -- OK via trimmed match, NULL area
    (100, '15', 1),               -- duplicate row
    (107, '17', 1), (107, '15', 1), -- one inactive, one running -> WARN
    (108, '19', 1), (108, '16', 1); -- 19 not running, 16 running -> OK
-- material 106: no mapping at all

INSERT INTO master.runningsize_lookup (equipment_id, rim_size) VALUES
    (501, '15'), (502, '15 '), (503, '18'), (504, '16'), (505, '21');   -- 21 not in master

INSERT INTO curing.o_production
    (equipment_id, recipe_id, production_id, material_id, quantity, quality_status,
     reason_id, cycletime, dtandtime, user_id, state) VALUES
    (1, 10, 'T0001', 100, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (1, 10, 'T0002', 100, 1, 1, 0, 600, now() - interval '2 hour', 1, 1),
    (2, 11, 'T0003', 101, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (3, 12, 'T0004', 102, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (4, 13, 'T0005', 103, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (5, 14, 'T0006', 104, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (6, 15, 'T0007', 105, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (7, NULL,'T0008', 106, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (1, 10, 'T0009', 100, 1, 2, 0, 600, now() - interval '1 hour', 1, 9),   -- not WIP (state 9)
    (1, 10, 'T0010', 100, 1, 1, 0, 600, now() - interval '3 hour', 1, 1),
    (2, 11, 'T0010', 101, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),   -- duplicate barcode, other material
    (8, 16, 'T0012', 107, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (9, 17, 'T0013', 108, 1, 1, 0, 600, now() - interval '1 hour', 1, 1);

-- Outside the default 2-day window: not WIP.
INSERT INTO curing.o_production
    (equipment_id, recipe_id, production_id, material_id, quantity, quality_status,
     reason_id, cycletime, dtandtime, user_id, state) VALUES
    (7, NULL, 'T0011', 106, 1, 1, 0, 600, now() - interval '3 days', 1, 1);

-- T0002 already balanced at DBM 501 -> no longer WIP.
-- DBM 506 is balancing tires but has no running rim size.
INSERT INTO dbm.o_production (equipment_id, dtandtime, barcode, total_rank) VALUES
    (501, now() - interval '30 minutes', 'T0002', 'A'),
    (506, now() - interval '20 minutes', 'X9999', 'B');
