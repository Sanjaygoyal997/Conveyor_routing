-- Scenario data built on the plant's rim_master: rim_size columns store rim_id.
-- Rims 4 (R24, area 12) and 9 (R17520, area 12) are made inactive for the tests.
INSERT INTO master.users VALUES (1);
INSERT INTO master.reason VALUES (0);
INSERT INTO master.recipe VALUES (10), (11), (12), (13), (14), (15), (16), (17), (18);

INSERT INTO master.rim_master (id, name, description, isactive, rim_id, local_area_id) VALUES
    (1,  'R20225',       'R20225',       true,  1,  12),
    (2,  'R195225',      'R195225',      true,  2,  12),
    (3,  'R22524',       'R22524',       true,  3,  12),
    (4,  'R24',          'R24',          false, 4,  12),   -- inactive (test)
    (5,  'R175195',      'R175195',      true,  5,  12),
    (6,  'UniversalRIM', 'UniversalRIM', true,  6,  12),
    (7,  'None',         'None',         true,  7,  12),
    (8,  'R225245',      'R225245',      true,  8,  12),
    (9,  'R17520',       'R17520',       false, 9,  12),   -- inactive (test)
    (10, 'R175195',      'R175195',      true,  10, 11),
    (11, 'R195225',      'R195225',      true,  11, 11),
    (12, 'R225245',      'R225245',      true,  12, 11),
    (13, 'R20225',       'R20225',       true,  13, 11),
    (14, 'R17520',       'R17520',       true,  14, 11),
    (15, 'UniversalRIM', 'UniversalRIM', true,  15, 11),
    (16, 'None',         'None',         true,  16, 11),
    (17, 'R22524',       'R22524',       true,  17, 11);

INSERT INTO master.material_size_lookup (material_id, rim_size, area_id) VALUES
    (100, '1', 12),                 -- R20225 -> OK
    (101, '1', 12), (101, '2', 12), -- R20225 + R195225, both running -> OK
    (102, '9', 12),                 -- only rim (R17520 area 12) is inactive
    (103, '4', 12),                 -- only rim (R24) is inactive
    (104, '8', 12),                 -- R225245, nobody running it
    (105, '3', NULL),               -- R22524, no area
    (100, '1', 12),                 -- duplicate row
    (107, '9', 12), (107, '1', 12), -- one inactive, one running -> WARN
    (108, '8', 12), (108, '2', 12), -- R225245 not running, R195225 running -> OK
    (109, '13', 11),                -- R20225 in area 11; runs on 501 (R20225 area 12 id)
    (110, '7', 12);                 -- mapped to None
-- material 106: no mapping at all

INSERT INTO master.runningsize_lookup (equipment_id, rim_size) VALUES
    (501, '1'), (502, '1 '),        -- R20225 (502 stored with a trailing space)
    (503, '3'),                     -- R22524
    (504, '2'),                     -- R195225
    (505, '5'),                     -- R175195: no WIP needs it
    (508, '4'),                     -- R24: rim deactivated while running
    (509, '7');                     -- None: not available

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
    (9, 17, 'T0013', 108, 1, 1, 0, 600, now() - interval '1 hour', 1, 1),
    (10, 18, 'T0014', 109, 1, 1, 0, 600, now() - interval '1 hour', 1, 1);

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
