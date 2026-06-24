// ============================================
//  PATIENT PANEL – PASSIVE MONITOR
//  Buttons are hardcoded in HTML – JS just highlights
// ============================================

const API_BASE = '/api';

// ---- DOM Elements ----
const patientNameDisplay = document.getElementById('patientNameDisplay');
const statusDisplay = document.getElementById('statusDisplay');
const led = document.getElementById('led');
const statusText = document.getElementById('statusText');

// ---- Clear all active highlights ----
function clearActive() {
    document.querySelectorAll('.service-btn').forEach(b => b.classList.remove('active'));
}

// ---- Update UI based on room status ----
function updatePanel(data) {
    // 1. Patient name
    patientNameDisplay.textContent = data.patient_name || 'Unassigned';

    // 2. Status display
    if (data.exists) {
        const status = data.status;
        const reqType = data.request_type;
        if (status === 'pending') {
            statusDisplay.textContent = `Requesting: ${reqType}`;
            statusDisplay.className = 'screen-value active';
            led.className = 'led busy';
            statusText.textContent = 'Pending...';
        } else if (status === 'accepted') {
            statusDisplay.textContent = `Accepted: ${reqType}`;
            statusDisplay.className = 'screen-value active';
            led.className = 'led busy';
            statusText.textContent = 'Staff assigned';
        } else if (status === 'workdone') {
            statusDisplay.textContent = `Completed: ${reqType}`;
            statusDisplay.className = 'screen-value completed';
            led.className = 'led';
            statusText.textContent = 'Completed';
        } else if (status === 'cancelled') {
            statusDisplay.textContent = `Cancelled`;
            statusDisplay.className = 'screen-value idle';
            led.className = 'led';
            statusText.textContent = 'Cancelled';
        } else {
            statusDisplay.textContent = 'Idle';
            statusDisplay.className = 'screen-value idle';
            led.className = 'led';
            statusText.textContent = 'Idle';
        }

        // 3. Highlight the corresponding button (1-9)
        clearActive();
        if (status === 'pending' || status === 'accepted') {
            // Map request_type to button number (1-9)
            const serviceMap = {
                'Call Nurse': '1',
                'Water Request': '2',
                'Food Request': '3',
                'Medicine Request': '4',
                'Cleaning Request': '5',
                'Wheelchair Assist': '6',
                'Family Assist': '7',
                'Tech Support': '8',
                'EMERGENCY ALERT': '9'
            };
            const btnNum = serviceMap[reqType];
            if (btnNum) {
                const btn = document.getElementById(`btn-${btnNum}`);
                if (btn) btn.classList.add('active');
            }
        }
    } else {
        // No active request
        statusDisplay.textContent = 'Idle';
        statusDisplay.className = 'screen-value idle';
        clearActive();
        led.className = 'led';
        statusText.textContent = 'Idle';
    }
}

// ---- Poll server for room status ----
async function fetchRoomStatus() {
    try {
        const res = await fetch(`${API_BASE}/room-request/${ROOM_NO}`);
        const data = await res.json();
        updatePanel(data);
    } catch (e) {
        console.error('Poll error:', e);
        statusDisplay.textContent = 'Error';
        statusDisplay.className = 'screen-value';
    }
}

// ---- Init ----
fetchRoomStatus();
setInterval(fetchRoomStatus, 3000);