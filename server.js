require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const stringSimilarity = require('string-similarity');
const { pmsDb, posDb, mdmDb } = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static('public'));

// ============================================================
// SAFE NUMBER — the single most important defensive helper
// ============================================================
// Converts null, undefined, NaN, and non-numeric strings to 0.
// Guarantees any numeric field sent to the browser is a real number,
// so the frontend never crashes on .toLocaleString() or .toFixed().
// ============================================================
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================
// SYNC LOGGER
// ============================================================
async function logSync(event_type, description, source, target, status = 'SUCCESS', metadata = null) {
  try {
    const [result] = await mdmDb.query(
      `INSERT INTO sync_events (event_type, description, source_system, target_system, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [event_type, description, source, target, status, metadata ? JSON.stringify(metadata) : null]
    );
    io.emit('sync-event', {
      id: result.insertId,
      event_type, description,
      source_module: source,
      target_module: target,
      status, metadata,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Sync log error:', e.message);
  }
}

// ============================================================
// FUZZY MATCHING  (case-insensitive + whitespace-normalized)
// ============================================================
function findBestGuestMatch(typedName, guests, threshold = 0.55) {
  if (!guests || guests.length === 0) return null;
  if (!typedName || !typedName.trim()) return null;

  // Normalize once — string-similarity is case-sensitive
  const normalize = (s) => (s == null ? '' : String(s).trim().toLowerCase().replace(/\s+/g, ' '));

  const query = normalize(typedName);
  if (!query) return null;

  const names = guests.map(g => normalize(g.guest_name));
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(query, names);

  if (bestMatch.rating >= threshold) {
    return {
      guest: guests[bestMatchIndex],
      score: Math.round(bestMatch.rating * 100),
      matchedName: guests[bestMatchIndex].guest_name
    };
  }
  return null;
}

// ============================================================
// DASHBOARD STATS
// ============================================================
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [roomsStatus] = await pmsDb.query(
      'SELECT status, COUNT(*) as count FROM rooms GROUP BY status'
    );
    const roomMap = { Available: 0, Reserved: 0, Occupied: 0, Cleaning: 0, Maintenance: 0 };
    roomsStatus.forEach(r => {
      if (r.status in roomMap) roomMap[r.status] = safeNumber(r.count);
    });
    const totalRooms = Object.values(roomMap).reduce((a, b) => a + b, 0);

    const [rev] = await pmsDb.query(`
      SELECT COALESCE(SUM(total_amount + COALESCE(folio_charges, 0)), 0) AS total
      FROM reservations WHERE status IN ('Checked-In', 'Checked-Out')
    `);

    const [active] = await pmsDb.query(
      "SELECT COUNT(*) AS c FROM reservations WHERE status IN ('Reserved', 'Checked-In')"
    );

    const [arrivals] = await pmsDb.query(
      "SELECT COUNT(*) AS c FROM reservations WHERE check_in_date = CURDATE() AND status = 'Reserved'"
    );

    const [departures] = await pmsDb.query(
      "SELECT COUNT(*) AS c FROM reservations WHERE check_out_date = CURDATE() AND status = 'Checked-In'"
    );

    const [revenueTrend] = await pmsDb.query(`
      SELECT DATE(created_at) AS date,
             COALESCE(SUM(total_amount + COALESCE(folio_charges, 0)), 0) AS total
      FROM reservations
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json({
      rooms: { ...roomMap, total: totalRooms },
      revenue: safeNumber(rev?.[0]?.total),
      activeBookings: safeNumber(active?.[0]?.c),
      arrivalsToday: safeNumber(arrivals?.[0]?.c),
      departuresToday: safeNumber(departures?.[0]?.c),
      revenueTrend: (revenueTrend || []).map(r => ({
        date: r.date,
        total: safeNumber(r.total)
      }))
    });
  } catch (e) {
    console.error('Dashboard stats error:', e);
    res.status(500).json({
      error: e.message,
      revenue: 0,
      activeBookings: 0,
      arrivalsToday: 0,
      departuresToday: 0,
      revenueTrend: [],
      rooms: { Available: 0, Reserved: 0, Occupied: 0, Cleaning: 0, Maintenance: 0, total: 0 }
    });
  }
});

// ============================================================
// HOTELS
// ============================================================
app.get('/api/hotels', async (req, res) => {
  try {
    const [rows] = await pmsDb.query('SELECT * FROM hotels ORDER BY id');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROOMS
// ============================================================
app.get('/api/rooms', async (req, res) => {
  try {
    const { status, hotel_id } = req.query;
    let sql = `
      SELECT r.*, h.name AS hotel_name
      FROM rooms r JOIN hotels h ON r.hotel_id = h.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { sql += ' AND r.status = ?'; params.push(status); }
    if (hotel_id) { sql += ' AND r.hotel_id = ?'; params.push(hotel_id); }
    sql += ' ORDER BY h.name, r.room_number';
    const [rows] = await pmsDb.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// RESERVATIONS
// ============================================================
app.get('/api/reservations', async (req, res) => {
  try {
    const [rows] = await pmsDb.query(`
      SELECT r.*, g.guest_name, g.email, g.phone,
             rm.room_number, rm.room_type, rm.rate_per_night,
             h.name AS hotel_name,
             (COALESCE(r.total_amount, 0) + COALESCE(r.folio_charges, 0)) AS grand_total
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN rooms rm ON r.room_id = rm.id
      JOIN hotels h ON rm.hotel_id = h.id
      ORDER BY
        CASE r.status
          WHEN 'Checked-In' THEN 1
          WHEN 'Reserved' THEN 2
          WHEN 'Checked-Out' THEN 3
          ELSE 4
        END,
        r.check_in_date ASC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reservations', async (req, res) => {
  const { guest_name, email, phone, room_id, check_in_date, check_out_date } = req.body;

  if (!guest_name || !room_id || !check_in_date || !check_out_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (new Date(check_in_date) >= new Date(check_out_date)) {
    return res.status(400).json({ error: 'Check-out date must be after check-in date' });
  }

  try {
    let guestId;
    const [existing] = await pmsDb.query(
      'SELECT id FROM guests WHERE guest_name = ?', [guest_name]
    );
    if (existing.length > 0) {
      guestId = existing[0].id;
    } else {
      const [ins] = await pmsDb.query(
        'INSERT INTO guests (guest_name, email, phone) VALUES (?, ?, ?)',
        [guest_name, email || '', phone || '']
      );
      guestId = ins.insertId;
    }

    const [roomRows] = await pmsDb.query('SELECT * FROM rooms WHERE id = ?', [room_id]);
    if (!roomRows.length) return res.status(404).json({ error: 'Room not found' });
    const room = roomRows[0];

    const [conflict] = await pmsDb.query(`
      SELECT id FROM reservations
      WHERE room_id = ? AND status IN ('Reserved', 'Checked-In')
      AND check_in_date < ? AND check_out_date > ?
    `, [room_id, check_out_date, check_in_date]);

    if (conflict.length > 0) {
      return res.status(409).json({ error: `Room ${room.room_number} is already booked for these dates` });
    }

    const nights = Math.ceil((new Date(check_out_date) - new Date(check_in_date)) / 86400000);
    const total = nights * safeNumber(room.rate_per_night);

    const [result] = await pmsDb.query(`
      INSERT INTO reservations (guest_id, room_id, check_in_date, check_out_date, status, total_amount, folio_charges)
      VALUES (?, ?, ?, ?, 'Reserved', ?, 0)
    `, [guestId, room_id, check_in_date, check_out_date, total]);

    await pmsDb.query('UPDATE rooms SET status = ? WHERE id = ?', ['Reserved', room_id]);

    await logSync('BOOKING_CREATED',
      `New booking #${result.insertId}: ${guest_name} - ${room.room_number} (${nights} nights, $${total})`,
      'Bookings', 'Rooms', 'SUCCESS',
      { reservation_id: result.insertId, guest_id: guestId, room_id });

    res.json({
      success: true,
      reservation_id: result.insertId,
      nights, total,
      room_number: room.room_number
    });
  } catch (e) {
    console.error('Create reservation error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/reservations/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Reserved', 'Checked-In', 'Checked-Out', 'Cancelled', 'No-Show'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const [resvRows] = await pmsDb.query(
      'SELECT * FROM reservations WHERE id = ?', [req.params.id]
    );
    if (!resvRows.length) return res.status(404).json({ error: 'Reservation not found' });
    const resv = resvRows[0];

    await pmsDb.query('UPDATE reservations SET status = ? WHERE id = ?', [status, req.params.id]);

    let newRoomStatus = null;
    if (status === 'Checked-In') newRoomStatus = 'Occupied';
    else if (status === 'Checked-Out' || status === 'Cancelled' || status === 'No-Show') newRoomStatus = 'Available';

    if (newRoomStatus) {
      await pmsDb.query('UPDATE rooms SET status = ? WHERE id = ?', [newRoomStatus, resv.room_id]);
    }

    await logSync(`RESERVATION_${status.toUpperCase().replace('-', '_')}`,
      `Reservation #${req.params.id} status updated to ${status}`,
      'Bookings', 'Rooms');

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PMS DATA
// ============================================================
app.get('/api/pms/data', async (req, res) => {
  try {
    const [rows] = await pmsDb.query(`
      SELECT r.id, g.guest_name, rm.room_number, rm.room_type,
             r.check_in_date, r.check_out_date,
             COALESCE(r.total_amount, 0) AS total_amount,
             COALESCE(r.folio_charges, 0) AS folio_charges,
             (COALESCE(r.total_amount, 0) + COALESCE(r.folio_charges, 0)) AS grand_total,
             r.status
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN rooms rm ON r.room_id = rm.id
      WHERE r.status IN ('Checked-In', 'Reserved')
      ORDER BY r.status DESC, r.check_in_date ASC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// POS CHARGE
// ============================================================
app.post('/api/pos/charge', async (req, res) => {
  const { customer_name, amount, idempotency_key } = req.body;

  if (!customer_name || !customer_name.trim() || !amount) {
    return res.status(400).json({ success: false, message: 'Customer name and amount are required' });
  }

  const idemKey = idempotency_key || `${customer_name}|${amount}|${Date.now()}|${Math.random()}`;

  const [existing] = await posDb.query(
    'SELECT id FROM transactions WHERE idempotency_key = ?', [idemKey]
  );
  if (existing.length > 0) {
    await logSync('IDEMPOTENT_SKIP',
      `Duplicate request for "${customer_name}" ($${amount}) ignored`,
      'POS', 'PMS');
    return res.json({
      success: true,
      idempotent: true,
      message: 'Duplicate request ignored (idempotent)',
      existing_transaction_id: existing[0].id
    });
  }

  try {
    const [insertResult] = await posDb.query(
      'INSERT INTO transactions (customer_name, amount, idempotency_key) VALUES (?, ?, ?)',
      [customer_name, amount, idemKey]
    );

    await logSync('POS_CHARGE',
      `$${amount} charged at POS for "${customer_name}"`,
      'POS', 'PMS');

    const [checkedIn] = await pmsDb.query(`
      SELECT g.id, g.guest_name, r.id AS reservation_id, rm.room_number
      FROM guests g
      JOIN reservations r ON g.id = r.guest_id
      JOIN rooms rm ON r.room_id = rm.id
      WHERE r.status = 'Checked-In'
    `);

    const match = findBestGuestMatch(customer_name, checkedIn);

    if (!match) {
      await logSync('SYNC_FAILED',
        `Guest "${customer_name}" not among checked-in guests. $${amount} stuck in POS.`,
        'POS', 'PMS', 'FAILED',
        { transaction_id: insertResult.insertId });
      return res.json({
        success: 'partial',
        message: `$${amount} charged to POS but "${customer_name}" not found among checked-in guests.`,
        pos_transaction_id: insertResult.insertId
      });
    }

    // Atomic increment with COALESCE to prevent NULL poisoning
    await pmsDb.query(
      'UPDATE reservations SET folio_charges = COALESCE(folio_charges, 0) + ? WHERE id = ?',
      [amount, match.guest.reservation_id]
    );

    const confidenceLabel = match.score >= 95 ? 'exact' : match.score >= 75 ? 'strong' : 'fuzzy';

    await logSync('SYNC_SUCCESS',
      `Matched "${customer_name}" to "${match.matchedName}" (${match.score}% ${confidenceLabel}). $${amount} added to folio.`,
      'POS', 'PMS', 'SUCCESS',
      { confidence: match.score, matched_to: match.matchedName, reservation_id: match.guest.reservation_id });

    res.json({
      success: true,
      message: `$${amount} charged to ${match.guest.guest_name} (${match.score}% match)`,
      matched_to: match.guest.guest_name,
      confidence: match.score,
      room_number: match.guest.room_number
    });

  } catch (e) {
    await logSync('SYNC_ERROR', `POS charge failed: ${e.message}`, 'POS', 'PMS', 'FAILED');
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================
// RACE CONDITION LAB
// ============================================================
async function unsafeReadModifyWrite(reservationId, amount) {
  const [rows] = await pmsDb.query(
    'SELECT COALESCE(folio_charges, 0) AS folio_charges FROM reservations WHERE id = ?',
    [reservationId]
  );
  const current = safeNumber(rows[0].folio_charges);
  await new Promise(r => setTimeout(r, 150));
  await pmsDb.query(
    'UPDATE reservations SET folio_charges = ? WHERE id = ?',
    [current + amount, reservationId]
  );
}

app.post('/api/pos/concurrent-charge', async (req, res) => {
  const { customer_name, amounts, mode = 'unsafe' } = req.body;

  if (!customer_name || !Array.isArray(amounts) || amounts.length !== 2) {
    return res.status(400).json({ error: 'Provide customer_name and amounts: [a, b]' });
  }

  const [resvRows] = await pmsDb.query(`
    SELECT r.id, COALESCE(r.folio_charges, 0) AS folio_charges, g.guest_name
    FROM reservations r JOIN guests g ON r.guest_id = g.id
    WHERE g.guest_name = ? AND r.status = 'Checked-In'
    LIMIT 1
  `, [customer_name]);

  if (!resvRows.length) {
    return res.status(404).json({ error: 'No checked-in reservation found for this guest' });
  }

  const reservationId = resvRows[0].id;
  const beforeValue = safeNumber(resvRows[0].folio_charges);

  await logSync('RACE_START',
    `Mode=${mode.toUpperCase()}: Two terminals charging "${customer_name}" with $${amounts[0]} + $${amounts[1]}`,
    'POS-A / POS-B', 'PMS');

  if (mode === 'unsafe') {
    await Promise.all([
      unsafeReadModifyWrite(reservationId, amounts[0]),
      unsafeReadModifyWrite(reservationId, amounts[1])
    ]);
  } else {
    await Promise.all([
      pmsDb.query('UPDATE reservations SET folio_charges = COALESCE(folio_charges, 0) + ? WHERE id = ?',
        [amounts[0], reservationId]),
      pmsDb.query('UPDATE reservations SET folio_charges = COALESCE(folio_charges, 0) + ? WHERE id = ?',
        [amounts[1], reservationId])
    ]);
  }

  const [after] = await pmsDb.query(
    'SELECT COALESCE(folio_charges, 0) AS folio_charges FROM reservations WHERE id = ?',
    [reservationId]
  );
  const afterValue = safeNumber(after[0].folio_charges);
  const expectedDelta = amounts[0] + amounts[1];
  const actualDelta = parseFloat((afterValue - beforeValue).toFixed(2));
  const isLostUpdate = Math.abs(actualDelta - expectedDelta) > 0.01;

  await logSync(
    isLostUpdate ? 'RACE_LOST_UPDATE' : 'RACE_COMPLETE',
    isLostUpdate
      ? `LOST UPDATE: Expected +$${expectedDelta} but got +$${actualDelta}`
      : `Clean race: both charges applied (+$${actualDelta})`,
    'PMS', 'PMS',
    isLostUpdate ? 'FAILED' : 'SUCCESS'
  );

  res.json({
    mode, before: beforeValue, after: afterValue,
    expected_delta: expectedDelta, actual_delta: actualDelta,
    lost_update: isLostUpdate,
    explanation: isLostUpdate
      ? 'LOST UPDATE: Both terminals read the same starting value. The last write overwrote the first.'
      : 'Clean race: atomic UPDATE prevented the lost update.'
  });
});

// ============================================================
// ETL
// ============================================================
app.post('/api/etl', async (req, res) => {
  const conn = await mdmDb.getConnection();
  try {
    await conn.beginTransaction();
    await logSync('ETL_START', 'Beginning ETL: Extract, Transform, Load', 'PMS + POS', 'MDM');

    const [pmsGuests] = await pmsDb.query('SELECT * FROM guests');
    const [posTx] = await posDb.query('SELECT * FROM transactions');
    const [reservations] = await pmsDb.query('SELECT * FROM reservations');

    const processed = [];
    for (const guest of pmsGuests) {
      let total = 0;
      let lowestConfidence = 100;
      for (const tx of posTx) {
        const match = findBestGuestMatch(tx.customer_name, [guest], 0.4);
        if (match) {
          total += safeNumber(tx.amount);
          lowestConfidence = Math.min(lowestConfidence, match.score);
        }
      }

      const guestRes = reservations.filter(r => r.guest_id === guest.id);
      const totalStays = guestRes.filter(r => r.status === 'Checked-Out').length;
      const totalNights = guestRes.reduce((sum, r) => {
        const nights = Math.ceil((new Date(r.check_out_date) - new Date(r.check_in_date)) / 86400000);
        return sum + (Number.isFinite(nights) ? nights : 0);
      }, 0);

      let tier = 'Bronze';
      if (total >= 100) tier = 'Silver';
      if (total >= 200) tier = 'Gold';
      if (total >= 500) tier = 'Platinum';

      await conn.query(`
        INSERT INTO golden_records
          (clean_name, pms_guest_id, total_pos_spend, match_confidence, loyalty_tier, total_stays, total_nights)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          clean_name = VALUES(clean_name),
          total_pos_spend = VALUES(total_pos_spend),
          match_confidence = VALUES(match_confidence),
          loyalty_tier = VALUES(loyalty_tier),
          total_stays = VALUES(total_stays),
          total_nights = VALUES(total_nights)
      `, [guest.guest_name, guest.id, total, lowestConfidence, tier, totalStays, totalNights]);

      processed.push({ name: guest.guest_name, spend: total, tier, stays: totalStays });
    }

    const orphans = posTx.filter(tx =>
      !findBestGuestMatch(tx.customer_name, pmsGuests, 0.4)
    );

    await conn.commit();
    await logSync('ETL_COMPLETE',
      `Processed ${processed.length} guests. ${orphans.length} orphans flagged.`,
      'PMS + POS', 'MDM', 'SUCCESS');

    res.json({
      processed: processed.length,
      orphans: orphans.length,
      details: processed,
      orphan_transactions: orphans.map(t => ({
        id: t.id, name: t.customer_name, amount: t.amount, item: t.item_ordered
      }))
    });
  } catch (e) {
    await conn.rollback();
    await logSync('ETL_ERROR', `ETL failed: ${e.message}`, 'PMS + POS', 'MDM', 'FAILED');
    res.status(500).json({ message: 'ETL Error: ' + e.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// MDM DATA
// ============================================================
app.get('/api/mdm/data', async (req, res) => {
  try {
    const [rows] = await mdmDb.query(
      'SELECT * FROM golden_records ORDER BY total_pos_spend DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CHECKOUT VIRTUALIZATION
// ============================================================
app.get('/api/checkout/:guest_id', async (req, res) => {
  try {
    const [receipt] = await mdmDb.query(`
      SELECT
        g.clean_name,
        COALESCE(g.total_pos_spend, 0) AS mdm_pos_spend,
        COALESCE(g.match_confidence, 100) AS match_confidence,
        g.loyalty_tier,
        COALESCE(g.total_stays, 0) AS total_stays,
        COALESCE(g.total_nights, 0) AS total_nights,
        r.id AS reservation_id,
        rm.room_number,
        rm.room_type,
        COALESCE(rm.rate_per_night, 0) AS rate_per_night,
        r.check_in_date,
        r.check_out_date,
        COALESCE(r.total_amount, 0) AS total_amount,
        COALESCE(r.folio_charges, 0) AS folio_charges,
        (COALESCE(r.total_amount, 0) + COALESCE(r.folio_charges, 0)) AS grand_total
      FROM golden_records g
      JOIN pms_db.reservations r ON g.pms_guest_id = r.guest_id
      JOIN pms_db.rooms rm ON r.room_id = rm.id
      WHERE g.pms_guest_id = ? AND r.status IN ('Checked-In', 'Reserved')
      LIMIT 1
    `, [req.params.guest_id]);

    if (receipt.length === 0) {
      return res.status(404).json({ error: 'No active reservation found for this guest' });
    }

    await logSync('CHECKOUT',
      `Virtualized receipt generated for guest #${req.params.guest_id}`,
      'MDM + PMS', 'Client');

    res.json({
      message: 'Checkout receipt generated',
      receipt: receipt[0],
      note: 'Generated via cross-database JOIN - data virtualized, not copied'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// SYNC LOG
// ============================================================
app.get('/api/sync/log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const [rows] = await mdmDb.query(
      'SELECT * FROM sync_events ORDER BY id DESC LIMIT ?', [limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// RESET
// ============================================================
app.post('/api/reset', async (req, res) => {
  try {
    await pmsDb.query("UPDATE reservations SET folio_charges = 0 WHERE status IN ('Reserved', 'Checked-In')");
    await posDb.query("DELETE FROM transactions WHERE idempotency_key NOT LIKE 'pre-%'");
    await mdmDb.query('DELETE FROM golden_records');
    await mdmDb.query('DELETE FROM sync_events');
    await logSync('SYSTEM_RESET', 'Folios, POS transactions, and MDM data reset to seed state', 'Admin', 'All');
    res.json({ success: true, message: 'System reset. Seed data preserved.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Grand Horizon Hotel Management System running at http://localhost:${PORT}`);
});
