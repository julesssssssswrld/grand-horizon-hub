DROP DATABASE IF EXISTS pms_db;
CREATE DATABASE pms_db;
USE pms_db;

CREATE TABLE hotels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL
);

INSERT INTO hotels (name, location) VALUES
('Grand Horizon Manila', 'Makati City'),
('Grand Horizon Cebu', 'Cebu City');

CREATE TABLE rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    room_number VARCHAR(10) NOT NULL,
    room_type VARCHAR(50) NOT NULL,
    rate_per_night DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'Available',
    floor INT DEFAULT 1,
    FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

INSERT INTO rooms (hotel_id, room_number, room_type, rate_per_night, status, floor) VALUES
(1, '101', 'Standard', 120.00, 'Available', 1),
(1, '102', 'Standard', 120.00, 'Available', 1),
(1, '103', 'Standard', 120.00, 'Available', 1),
(1, '104', 'Standard', 120.00, 'Available', 1),
(1, '105', 'Standard', 120.00, 'Available', 1),
(1, '201', 'Deluxe',   180.00, 'Available', 2),
(1, '202', 'Deluxe',   180.00, 'Available', 2),
(1, '203', 'Deluxe',   180.00, 'Available', 2),
(1, '301', 'Suite',    280.00, 'Available', 3),
(1, '302', 'Suite',    280.00, 'Available', 3),
(2, '101', 'Standard', 110.00, 'Available', 1),
(2, '102', 'Standard', 110.00, 'Available', 1),
(2, '103', 'Standard', 110.00, 'Available', 1),
(2, '104', 'Standard', 110.00, 'Available', 1),
(2, '105', 'Standard', 110.00, 'Available', 1),
(2, '201', 'Deluxe',   165.00, 'Available', 2),
(2, '202', 'Deluxe',   165.00, 'Available', 2),
(2, '203', 'Deluxe',   165.00, 'Available', 2),
(2, '301', 'Suite',    260.00, 'Available', 3),
(2, '302', 'Suite',    260.00, 'Available', 3);

CREATE TABLE guests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guest_name VARCHAR(100),
    email VARCHAR(150),
    phone VARCHAR(30)
);

INSERT INTO guests (guest_name, email, phone) VALUES
('Bob Smith',             'bob.smith@email.com',      '0917-100-0001'),
('Sarah Connor',          'sarah.connor@email.com',   '0917-100-0002'),
('Michael Scott',         'michael.scott@email.com',  '0917-100-0003'),
('John Doe',              'john.doe@email.com',       '0917-100-0004'),
('Robert Smithers',       'rsmithers@email.com',      '0917-100-0005'),
('Bobby Smith',           NULL,                        '0917-100-0006'),
('Michal Scott',          'michal.scott@email.com',   '0917-100-0007'),
('JOHN DOE',              'johndoe2@email.com',       '0917-100-0008'),
('Test Guest',            'test@invalid',              NULL),
('Ana Reyes',             'ana.reyes@email.com',      '0917-100-0010'),
('Mr. & Mrs. Anderson',   'anderson@email.com',       '0917-100-0011'),
('Jose Garcia',           'jose.garcia@email.com',    '0917-100-0012'),
('Bruce Lee',             'bruce.lee@email.com',      '0917-100-0013'),
('Patrick OBrien',        'pat.obrien@email.com',     '0917-100-0014'),
('Maria Santos-Garcia',   'maria.sg@email.com',       '0917-100-0015'),
('Smith',                 'unknown@email.com',        NULL),
('Dr. Emmett Brown',      'doc.brown@email.com',      '0917-100-0017'),
('Bob Smith',             'bob.smith@email.com',      '0917-100-0018'),
('David Tennant',         'david.t@email.com',        '0917-100-0019'),
('Alice Wonderland',      'alice.w@email.com',        '0917-100-0020');

CREATE TABLE reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guest_id INT NOT NULL,
    room_id INT NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'Reserved',
    total_amount DECIMAL(10,2) DEFAULT 0,
    folio_charges DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

INSERT INTO reservations (guest_id, room_id, check_in_date, check_out_date, status, total_amount, folio_charges) VALUES
(2,  1,  DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'Checked-In', 480.00, 0),
(3,  3,  DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'Checked-In', 480.00, 0),
(1,  4,  CURDATE(),                            DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'Checked-In', 480.00, 0),
(4,  5,  DATE_SUB(CURDATE(), INTERVAL 3 DAY), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'Checked-In', 480.00, 0),
(12, 11, DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'Checked-In', 330.00, 0),
(10, 6,  CURDATE(),                            DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'Reserved',   540.00, 0),
(19, 7,  DATE_ADD(CURDATE(), INTERVAL 3 DAY), DATE_ADD(CURDATE(), INTERVAL 6 DAY), 'Reserved',   540.00, 0),
(20, 8,  DATE_ADD(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'Reserved',   360.00, 0),
(15, 12, DATE_ADD(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'Reserved',   330.00, 0),
(11, 9,  DATE_ADD(CURDATE(), INTERVAL 5 DAY), DATE_ADD(CURDATE(), INTERVAL 8 DAY), 'Reserved',   840.00, 0),
(17, 1,  DATE_SUB(CURDATE(), INTERVAL 12 DAY), DATE_SUB(CURDATE(), INTERVAL 7 DAY), 'Checked-Out', 600.00, 0),
(14, 2,  DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_SUB(CURDATE(), INTERVAL 18 DAY), 'Checked-Out', 240.00, 0),
(19, 3,  DATE_SUB(CURDATE(), INTERVAL 35 DAY), DATE_SUB(CURDATE(), INTERVAL 32 DAY), 'Checked-Out', 360.00, 0),
(16, 5,  DATE_ADD(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'Cancelled', 240.00, 0),
(13, 7,  DATE_SUB(CURDATE(), INTERVAL 5 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'No-Show',   540.00, 0);

UPDATE rooms SET status = 'Occupied' WHERE id IN (1, 3, 4, 5, 11);
UPDATE rooms SET status = 'Reserved' WHERE id IN (6, 7, 8, 9, 12);

DROP DATABASE IF EXISTS pos_db;
CREATE DATABASE pos_db;
USE pos_db;

CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(100),
    item_ordered VARCHAR(100),
    amount DECIMAL(10,2),
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO transactions (customer_name, item_ordered, amount, idempotency_key) VALUES
('Sarah Connor',        'Breakfast Buffet',  50.00, 'pre-001'),
('Michael Scott',       'Dinner Set',        85.00, 'pre-002'),
('Bob Smith',           'Minibar',           30.00, 'pre-003'),
('Robert Smith',        'Bar Tab',           45.00, 'pre-004'),
('Mike Scott',          'Lunch',             25.00, 'pre-005'),
('M. Scott',            'Coffee',            10.00, 'pre-006'),
('Bobby Smith',         'Room Service',      40.00, 'pre-007'),
('Jose Garcia',         'Dinner',            55.00, 'pre-008'),
('JOSE GARCIA',         'Minibar',           15.00, 'pre-009'),
('Maria Santos-Garcia', 'Restaurant',        60.00, 'pre-010'),
('Dr. Brown',           'Bar',               35.00, 'pre-011'),
('Bruce Lee',           'Restaurant',        45.00, 'pre-012'),
('OBrien',              'Coffee',             8.00, 'pre-013'),
('Jim Halpert',         'Restaurant Bill',   65.00, 'pre-014'),
('Pam Beesly',          'Spa Treatment',    120.00, 'pre-015'),
('Dwight Schrute',      'Bar Tab',           80.00, 'pre-016'),
('Random Walker',       'Coffee',             5.00, 'pre-017'),
('  ',                  'Walk-in Coffee',     5.00, 'pre-018'),
('john doe',            'Lunch',             20.00, 'pre-019'),
('SMITH',               'Lunch',             25.00, 'pre-020'),
('Bob',                 'Bar',               20.00, 'pre-021'),
('Alice',               'Dinner',           100.00, 'pre-022'),
('Ana Reyes',           'Spa',             -100.00, 'pre-023'),
('David Tenant',        'Restaurant',        75.00, 'pre-024'),
('Sarah Connor',        'Dinner',            60.00, 'pre-025');

DROP DATABASE IF EXISTS mdm_db;
CREATE DATABASE mdm_db;
USE mdm_db;

CREATE TABLE golden_records (
    mdm_id INT AUTO_INCREMENT PRIMARY KEY,
    clean_name VARCHAR(100),
    pms_guest_id INT UNIQUE,
    total_pos_spend DECIMAL(10,2) DEFAULT 0.00,
    match_confidence DECIMAL(5,2) DEFAULT 100.00,
    loyalty_tier VARCHAR(20) DEFAULT 'Bronze',
    total_stays INT DEFAULT 0,
    total_nights INT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE sync_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    description TEXT,
    source_system VARCHAR(50),
    target_system VARCHAR(50),
    status VARCHAR(20) DEFAULT 'SUCCESS',
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at)
);
