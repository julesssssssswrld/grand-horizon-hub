const API = 'http://localhost:3000';
const socket = io();

let syncCount = 0;
let revenueChart = null;
let roomChart = null;
let cacheRooms = [];
let cacheReservations = [];
let cacheHotels = [];

// Safe number helper
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const viewTitles = {
  dashboard: 'Dashboard',
  bookings: 'Bookings',
  rooms: 'Rooms',
  pos: 'POS Terminal',
  mdm: 'Master Data Management',
  labs: 'Advanced Labs',
  synclog: 'Sync Log'
};

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.view));
});

function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');
  document.getElementById(`view-${view}`).classList.add('active');
  document.getElementById('viewTitle').textContent = viewTitles[view];

  if (view === 'dashboard') loadDashboard();
  if (view === 'bookings') loadBookings();
  if (view === 'rooms') loadRooms();
  if (view === 'pos') loadPOSView();
  if (view === 'mdm') loadMDM();
  if (view === 'synclog') loadSyncLog();
}
window.navigateTo = navigateTo;

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.className = 'toast', 3200);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

setInterval(() => {
  const clock = document.getElementById('clock');
  if (clock) {
    const d = new Date();
    clock.textContent = d.toLocaleString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
}, 1000);

socket.on('sync-event', (ev) => {
  syncCount++;
  const counter = document.getElementById('syncCount');
  if (counter) counter.textContent = `${syncCount} events`;
  appendSyncEvent(ev, 'dashSyncEvents', 5);
  appendSyncEvent(ev, 'syncLogFull', 100);

  if (['SYNC_SUCCESS', 'RACE_COMPLETE', 'RACE_LOST_UPDATE', 'BOOKING_CREATED',
       'RESERVATION_CHECKED_IN', 'RESERVATION_CHECKED_OUT'].includes(ev.event_type)) {
    if (document.getElementById('view-dashboard')?.classList.contains('active')) loadDashboard();
    if (document.getElementById('view-bookings')?.classList.contains('active')) loadBookings();
    if (document.getElementById('view-pos')?.classList.contains('active')) loadPOSView();
  }
});

function appendSyncEvent(ev, containerId, maxRows) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const div = document.createElement('div');
  div.className = `sync-row ${ev.status}`;

  const statusIcon = ev.status === 'FAILED' ? 'X' : 'OK';
  const time = new Date(ev.created_at).toLocaleTimeString();

  div.innerHTML = `
    <div class="sync-row-header">
      <span>${statusIcon} ${ev.event_type}</span>
      <span>${time}</span>
    </div>
    <div class="sync-row-desc">${ev.description}</div>
    <div class="sync-row-meta">${ev.source_module} to ${ev.target_module}</div>
  `;

  container.prepend(div);
  while (container.children.length > maxRows) {
    container.removeChild(container.lastChild);
  }
}

function clearSyncUI() {
  document.getElementById('syncLogFull').innerHTML = '';
  syncCount = 0;
  document.getElementById('syncCount').textContent = '0 events';
  toast('UI cleared', 'warn');
}
window.clearSyncUI = clearSyncUI;

// ============================================================
// DASHBOARD — FIXED for null values
// ============================================================
async function loadDashboard() {
  try {
    const stats = await api('GET', '/api/dashboard/stats');

    // Safe coercion — never trust the server to return clean numbers
    const roomsData = stats.rooms || {};
    const available = num(roomsData.Available);
    const reserved = num(roomsData.Reserved);
    const occupied = num(roomsData.Occupied);
    const total = num(roomsData.total);
    const revenue = num(stats.revenue);
    const activeBookings = num(stats.activeBookings);
    const arrivals = num(stats.arrivalsToday);
    const departures = num(stats.departuresToday);

    const occupancyRate = total > 0
      ? Math.round(((occupied + reserved) / total) * 100)
      : 0;

    document.getElementById('kpiOccupancy').textContent = `${occupancyRate}%`;
    document.getElementById('kpiOccupancySub').textContent =
      `${occupied + reserved} of ${total} rooms`;
    document.getElementById('kpiRevenue').textContent =
      `$${revenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
    document.getElementById('kpiActive').textContent = activeBookings;
    document.getElementById('kpiTodayActivity').textContent = arrivals + departures;
    document.getElementById('kpiTodaySub').textContent =
      `${arrivals} arrivals / ${departures} departures`;

    renderRevenueChart(stats.revenueTrend || []);
    renderRoomChart({ Available: available, Reserved: reserved, Occupied: occupied });

    const reservations = await api('GET', '/api/reservations');
    const active = reservations.filter(r => ['Checked-In', 'Reserved'].includes(r.status)).slice(0, 6);
    renderDashboardReservations(active);
  } catch (e) {
    console.error('Dashboard error:', e);
    // Set safe fallback values so UI is not broken
    document.getElementById('kpiOccupancy').textContent = '0%';
    document.getElementById('kpiOccupancySub').textContent = '0 of 0 rooms';
    document.getElementById('kpiRevenue').textContent = '$0';
    document.getElementById('kpiActive').textContent = '0';
    document.getElementById('kpiTodayActivity').textContent = '0';
    document.getElementById('kpiTodaySub').textContent = '0 arrivals / 0 departures';
  }
}

function renderRevenueChart(trend) {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const found = (trend || []).find(t => new Date(t.date).toISOString().split('T')[0] === iso);
    labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    data.push(found ? num(found.total) : 0);
  }

  if (revenueChart) revenueChart.destroy();

  revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue ($)',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.35,
        pointRadius: 5,
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => '$' + v }, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderRoomChart(rooms) {
  const canvas = document.getElementById('roomChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (roomChart) roomChart.destroy();

  roomChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Available', 'Reserved', 'Occupied'],
      datasets: [{
        data: [num(rooms.Available), num(rooms.Reserved), num(rooms.Occupied)],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 3,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } }
      }
    }
  });
}

function renderDashboardReservations(reservations) {
  const el = document.getElementById('dashReservations');
  if (!el) return;

  if (!reservations.length) {
    el.innerHTML = '<p class="card-desc">No active reservations.</p>';
    return;
  }

  let html = '<div class="table-wrap" style="max-height:340px;border:none"><table><tr><th>Guest</th><th>Room</th><th>Dates</th><th>Status</th></tr>';
  reservations.forEach(r => {
    html += `<tr>
      <td>${r.guest_name}</td>
      <td>${r.room_number}</td>
      <td>${r.check_in_date} to ${r.check_out_date}</td>
      <td><span class="status-pill ${r.status.toLowerCase()}">${r.status}</span></td>
    </tr>`;
  });
  el.innerHTML = html + '</table></div>';
}

// ============================================================
// BOOKINGS
// ============================================================
async function loadBookings() {
  cacheHotels = await api('GET', '/api/hotels');
  const hotelSelect = document.getElementById('bkHotel');
  if (hotelSelect) {
    hotelSelect.innerHTML = '<option value="">Select hotel</option>' +
      cacheHotels.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  }

  const roomFilter = document.getElementById('roomFilterHotel');
  if (roomFilter) {
    roomFilter.innerHTML = '<option value="">All Hotels</option>' +
      cacheHotels.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  }

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  if (document.getElementById('bkCheckIn') && !document.getElementById('bkCheckIn').value) {
    document.getElementById('bkCheckIn').value = today;
    document.getElementById('bkCheckOut').value = tomorrow;
  }

  cacheReservations = await api('GET', '/api/reservations');
  renderBookingsList(cacheReservations);
}

async function updateBookingRooms() {
  const hotelId = document.getElementById('bkHotel').value;
  if (!hotelId) return;

  const rooms = await api('GET', `/api/rooms?hotel_id=${hotelId}`);
  document.getElementById('bkRoom').innerHTML =
    '<option value="">Select room</option>' +
    rooms.map(r => `<option value="${r.id}">${r.room_number} - ${r.room_type} ($${r.rate_per_night}/night)</option>`).join('');
}
window.updateBookingRooms = updateBookingRooms;

const bookingForm = document.getElementById('bookingForm');
if (bookingForm) {
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      guest_name: document.getElementById('bkGuestName').value.trim(),
      email: document.getElementById('bkEmail').value.trim(),
      phone: document.getElementById('bkPhone').value.trim(),
      room_id: parseInt(document.getElementById('bkRoom').value),
      check_in_date: document.getElementById('bkCheckIn').value,
      check_out_date: document.getElementById('bkCheckOut').value
    };

    if (!payload.room_id) return toast('Please select a room', 'error');

    try {
      const result = await api('POST', '/api/reservations', payload);
      toast(`Booking created: ${result.nights} nights, $${result.total}`, 'success');
      e.target.reset();
      loadBookings();
      loadRooms();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

['bkCheckIn', 'bkCheckOut', 'bkRoom'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      const rate = document.getElementById('bkRoom').selectedOptions[0]?.text.match(/\$([\d.]+)/);
      const ci = document.getElementById('bkCheckIn').value;
      const co = document.getElementById('bkCheckOut').value;
      const estimate = document.getElementById('bookingEstimate');
      if (rate && ci && co && estimate) {
        const nights = Math.ceil((new Date(co) - new Date(ci)) / 86400000);
        if (nights > 0) {
          estimate.textContent = `Total: $${(nights * parseFloat(rate[1])).toFixed(2)} (${nights} nights)`;
          return;
        }
      }
      if (estimate) estimate.textContent = '';
    });
  }
});

function renderBookingsList(reservations) {
  const search = (document.getElementById('bookingSearch')?.value || '').toLowerCase();
  const filtered = reservations.filter(r =>
    !search ||
    r.guest_name.toLowerCase().includes(search) ||
    r.room_number.toLowerCase().includes(search)
  );

  if (!filtered.length) {
    document.getElementById('bookingsList').innerHTML =
      '<p class="card-desc">No reservations found.</p>';
    return;
  }

  let html = `<table>
    <tr><th>ID</th><th>Guest</th><th>Room</th><th>Dates</th><th>Total</th><th>Status</th><th>Actions</th></tr>`;

  filtered.forEach(r => {
    const canCheckIn = r.status === 'Reserved';
    const canCheckOut = r.status === 'Checked-In';
    const canCancel = r.status === 'Reserved';

    html += `<tr>
      <td>#${r.id}</td>
      <td>${r.guest_name}</td>
      <td>${r.room_number}<br><span style="font-size:11px;color:#64748b">${r.room_type}</span></td>
      <td>${r.check_in_date}<br>${r.check_out_date}</td>
      <td>$${num(r.grand_total).toFixed(2)}</td>
      <td><span class="status-pill ${r.status.toLowerCase()}">${r.status}</span></td>
      <td>
        ${canCheckIn ? `<button class="btn-success small" onclick="updateResStatus(${r.id}, 'Checked-In')">Check-In</button>` : ''}
        ${canCheckOut ? `<button class="btn-warning small" onclick="updateResStatus(${r.id}, 'Checked-Out')">Check-Out</button>` : ''}
        ${canCancel ? `<button class="btn-ghost small" onclick="updateResStatus(${r.id}, 'Cancelled')">Cancel</button>` : ''}
      </td>
    </tr>`;
  });

  document.getElementById('bookingsList').innerHTML = html + '</table>';
}

const bookingSearch = document.getElementById('bookingSearch');
if (bookingSearch) {
  bookingSearch.addEventListener('input', () => {
    renderBookingsList(cacheReservations);
  });
}

async function updateResStatus(id, status) {
  try {
    await api('PUT', `/api/reservations/${id}/status`, { status });
    toast(`Reservation #${id}: ${status}`, 'success');
    loadBookings();
    loadRooms();
  } catch (err) {
    toast(err.message, 'error');
  }
}
window.updateResStatus = updateResStatus;

// ============================================================
// ROOMS
// ============================================================
async function loadRooms() {
  const hotel = document.getElementById('roomFilterHotel')?.value || '';
  const status = document.getElementById('roomFilterStatus')?.value || '';

  let url = '/api/rooms?';
  if (hotel) url += `hotel_id=${hotel}&`;
  if (status) url += `status=${status}&`;

  const rooms = await api('GET', url);
  cacheRooms = rooms;

  const grid = document.getElementById('roomGrid');
  if (!grid) return;

  if (!rooms.length) {
    grid.innerHTML = '<p class="card-desc">No rooms match the selected filters.</p>';
    return;
  }

  grid.innerHTML = rooms.map(r => `
    <div class="room-card ${r.status}">
      <div class="room-card-number">${r.room_number}</div>
      <div class="room-card-hotel">${r.hotel_name}</div>
      <div class="room-card-type">${r.room_type}</div>
      <div class="room-card-status ${r.status}">${r.status}</div>
      <div class="room-card-rate">$${num(r.rate_per_night).toFixed(0)}/night</div>
    </div>
  `).join('');
}

// ============================================================
// POS
// ============================================================
async function loadPOSView() {
  const reservations = await api('GET', '/api/reservations');
  const checkedIn = reservations.filter(r => r.status === 'Checked-In');

  const el = document.getElementById('posCheckedIn');
  if (!el) return;

  el.innerHTML = checkedIn.length === 0
    ? '<p class="card-desc">No checked-in guests.</p>'
    : `<div class="table-wrap" style="max-height:300px;border:none"><table>
        <tr><th>Guest</th><th>Room</th><th>Folio</th></tr>
        ${checkedIn.map(r => `
          <tr>
            <td>${r.guest_name}</td>
            <td>${r.room_number}</td>
            <td>$${num(r.folio_charges).toFixed(2)}</td>
          </tr>
        `).join('')}
      </table></div>`;
}

const posForm = document.getElementById('posForm');
if (posForm) {
  posForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('posName').value.trim();
    const amount = parseFloat(document.getElementById('posAmount').value);
    const useIdem = document.getElementById('useIdempotency').checked;

    if (!name || !amount) return toast('Fill all fields', 'error');

    const idemKey = useIdem
      ? `manual-${name}-${amount}-${window.__lastIdemKey || (window.__lastIdemKey = Date.now())}`
      : undefined;

    const statusEl = document.getElementById('posStatus');
    statusEl.className = 'status-box';
    statusEl.textContent = 'Processing...';

    try {
      const result = await api('POST', '/api/pos/charge', {
        customer_name: name,
        amount,
        idempotency_key: idemKey
      });

      if (result.success === true) {
        statusEl.className = 'status-box success';
        toast(result.message, 'success');
      } else if (result.success === 'partial') {
        statusEl.className = 'status-box warn';
        toast('Charge pending reconciliation', 'warn');
      } else {
        statusEl.className = 'status-box error';
        toast(result.message, 'error');
      }
      statusEl.textContent = result.message;

      loadPOSView();
    } catch (err) {
      statusEl.className = 'status-box error';
      statusEl.textContent = err.message;
      toast(err.message, 'error');
    }
  });
}

// ============================================================
// MDM
// ============================================================
async function loadMDM() {
  const data = await api('GET', '/api/mdm/data');
  const el = document.getElementById('mdmTable');
  if (!el) return;

  if (!data.length) {
    el.innerHTML = '<p class="card-desc">No golden records yet. Click "Run ETL" to generate them.</p>';
    return;
  }

  let html = `<table>
    <tr><th>Name</th><th>Total POS Spend</th><th>Match Confidence</th><th>Stays</th><th>Nights</th><th>Tier</th></tr>`;

  data.forEach(r => {
    html += `<tr>
      <td>${r.clean_name}</td>
      <td>$${num(r.total_pos_spend).toFixed(2)}</td>
      <td>${num(r.match_confidence).toFixed(0)}%</td>
      <td>${num(r.total_stays)}</td>
      <td>${num(r.total_nights)}</td>
      <td><span class="tier-${(r.loyalty_tier || 'bronze').toLowerCase()}">${r.loyalty_tier || 'Bronze'}</span></td>
    </tr>`;
  });

  el.innerHTML = html + '</table>';
}

async function runETL() {
  toast('Running ETL...', 'warn');
  try {
    const result = await api('POST', '/api/etl');
    const msg = `ETL complete: ${result.processed} guests processed, ${result.orphans} orphans flagged.`;
    toast(msg, result.orphans > 0 ? 'warn' : 'success');
    loadMDM();
  } catch (err) {
    toast('ETL failed: ' + err.message, 'error');
  }
}
window.runETL = runETL;

// ============================================================
// RACE LAB
// ============================================================
async function runRace(mode) {
  const customer_name = document.getElementById('raceName').value.trim();
  const a = parseFloat(document.getElementById('raceAmountA').value);
  const b = parseFloat(document.getElementById('raceAmountB').value);
  const el = document.getElementById('raceResult');

  if (!customer_name || isNaN(a) || isNaN(b)) {
    el.className = 'status-box error';
    el.textContent = 'Fill all fields';
    return;
  }

  el.className = 'status-box';
  el.textContent = `Running ${mode.toUpperCase()} race...`;

  try {
    const result = await api('POST', '/api/pos/concurrent-charge', {
      customer_name,
      amounts: [a, b],
      mode
    });

    const fmt = (n) => '$' + Number(n).toFixed(2);
    el.className = result.lost_update ? 'status-box error' : 'status-box success';
    el.innerHTML = `
      <div style="font-family:monospace;line-height:1.7">
        <strong>Mode:</strong> ${result.mode.toUpperCase()}<br>
        Before: ${fmt(result.before)}<br>
        After:  ${fmt(result.after)}<br>
        Expected change: +${fmt(result.expected_delta)}<br>
        Actual change:   <strong>+${fmt(result.actual_delta)}</strong><br><br>
        ${result.explanation}
      </div>
    `;

    toast(result.lost_update ? 'Lost update detected!' : 'Race handled safely',
      result.lost_update ? 'error' : 'success');
  } catch (err) {
    el.className = 'status-box error';
    el.textContent = err.message;
    toast(err.message, 'error');
  }
}
window.runRace = runRace;

// ============================================================
// CHECKOUT
// ============================================================
async function runCheckout() {
  const id = document.getElementById('checkoutId').value;
  const el = document.getElementById('checkoutResult');
  el.textContent = 'Generating...';

  try {
    const data = await api('GET', `/api/checkout/${id}`);
    el.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}
window.runCheckout = runCheckout;

// ============================================================
// SYNC LOG
// ============================================================
async function loadSyncLog() {
  const events = await api('GET', '/api/sync/log?limit=100');
  const container = document.getElementById('syncLogFull');
  if (!container) return;

  container.innerHTML = '';

  events.forEach(e => {
    appendSyncEvent({
      event_type: e.event_type,
      description: e.description,
      source_module: e.source_system,
      target_module: e.target_system,
      status: e.status,
      created_at: e.created_at
    }, 'syncLogFull', 100);
  });
}

async function resetSystem() {
  if (!confirm('Reset all data to the seed state? This will clear folios, POS charges, and MDM records.')) return;
  try {
    await api('POST', '/api/reset');
    toast('System reset', 'success');
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}
window.resetSystem = resetSystem;

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const events = await api('GET', '/api/sync/log?limit=100');
    syncCount = events.length;
    const counter = document.getElementById('syncCount');
    if (counter) counter.textContent = `${syncCount} events`;
  } catch (e) { /* ignore */ }

  loadDashboard();
});
