// ============================================
// CONFIGURATION
// ============================================
const API_BASE = 'http://127.0.0.1:5000/api';

// ---- State ----
let allRequests = [];
let searchQuery = '';
let refreshInterval = null;

// ============================================
//  DING SOUND (Web Audio API)
// ============================================
function playDingSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create two oscillators for a rich "ding" sound
        const oscillator1 = audioContext.createOscillator();
        const oscillator2 = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator1.type = 'sine';
        oscillator1.frequency.value = 880; // A5
        oscillator2.type = 'sine';
        oscillator2.frequency.value = 1320; // E6
        
        gainNode.gain.value = 0.3;
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.8);
        
        oscillator1.connect(gainNode);
        oscillator2.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator1.start();
        oscillator2.start();
        oscillator1.stop(audioContext.currentTime + 0.8);
        oscillator2.stop(audioContext.currentTime + 0.8);
    } catch (e) {
        // Fallback: use a simple beep via console
        console.log('🔔 Ding! (Audio not supported)');
    }
}

// ============================================
// DARK MODE
// ============================================
function toggleDarkMode(e) {
    if (e.target.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    }
}

function loadThemePreference() {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('darkModeToggle').checked = true;
    } else {
        document.documentElement.removeAttribute('data-theme');
        document.getElementById('darkModeToggle').checked = false;
    }
}

// ============================================
// HELPERS
// ============================================
function getStatusInfo(status) {
    const map = {
        'pending': { label: 'Pending', cls: 'pending' },
        'accepted': { label: 'Accepted', cls: 'accepted' },
        'workdone': { label: 'Completed', cls: 'workdone' },
        'cancelled': { label: 'Cancelled', cls: 'cancelled' }
    };
    return map[status] || { label: status, cls: 'pending' };
}

function getCardClass(type) {
    return type.toLowerCase().replace(/\s+/g, '-');
}

// ============================================
// RENDER ENGINE (Active Only)
// ============================================
function filterAndRender() {
    if (!allRequests || allRequests.length === 0) {
        renderPatients([]);
        return;
    }

    let filtered = allRequests.filter(p => p.status === 'pending' || p.status === 'accepted');

    if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(p =>
            p.patient_name.toLowerCase().includes(q) ||
            p.room.toLowerCase().includes(q)
        );
    }

    filtered.sort((a, b) => {
        if (a.priority === 'high' && b.priority !== 'high') return -1;
        if (a.priority !== 'high' && b.priority === 'high') return 1;
        return 0;
    });

    renderPatients(filtered);
}

function renderPatients(requests) {
    const container = document.getElementById('patientContainer');
    if (!container) return;

    if (!requests || requests.length === 0) {
        container.innerHTML = `<div class="no-results"><div class="big-icon">─</div>No active requests. All clear.</div>`;
        return;
    }

    container.innerHTML = '';
    requests.forEach((p) => {
        const statusInfo = getStatusInfo(p.status);
        const cardType = getCardClass(p.request_type);
        const isPending = p.status === 'pending';
        const isAccepted = p.status === 'accepted';
        const isHighPriority = p.priority === 'high';

        let btnHTML = '';
        if (isPending) {
            btnHTML = `
                <button class="btn btn-accept" onclick="updateStatus('${p.id}', 'accept')">Accept</button>
                <button class="btn btn-reset" onclick="updateStatus('${p.id}', 'reset')">Reset</button>
            `;
        } else if (isAccepted) {
            btnHTML = `
                <button class="btn btn-accept" disabled>Accepted</button>
                <button class="btn btn-workdone" onclick="updateStatus('${p.id}', 'workdone')">Complete</button>
                <button class="btn btn-reset" disabled>Reset</button>
            `;
        }

        const card = document.createElement('div');
        card.className = `card ${cardType} ${isHighPriority ? 'priority-high' : ''}`;
        card.id = `patient_${p.id}`;

        // ⚠️ REMOVED: <div class="status-area"> ... </div>
        card.innerHTML = `
            <div class="card-header">
                <span class="title-badge">
                    <span class="request-type">${p.request_type}</span>
                    ${isHighPriority ? '<span class="priority-tag">Urgent</span>' : ''}
                </span>
                <span class="status-badge ${statusInfo.cls}" id="statusBadge_${p.id}">${statusInfo.label}</span>
            </div>
            <h2>${p.patient_name}</h2>
            <div class="detail">
                <span>Room: ${p.room}</span>
                <span>Assigned: ${p.assigned_staff || 'Unassigned'}</span>
            </div>
            <div class="btn-group">${btnHTML}</div>
        `;
        container.appendChild(card);
    });
}
// ============================================
//  GRANT ACCESS
// ============================================
async function grantAccess() {
    const name = document.getElementById('patientNameInput').value.trim();
    const room = document.getElementById('patientRoomInput').value.trim();
    const msgEl = document.getElementById('patientAccessMessage');

    if (!name || !room) {
        msgEl.innerHTML = '<span style="color: var(--accent-red);">⚠️ Please enter both patient name and room number.</span>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/rooms/grant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, room_no: room })
        });
        const data = await res.json();

        if (res.ok) {
            msgEl.innerHTML = `<span style="color: var(--accent-green);">✅ ${data.message}</span>`;
            document.getElementById('patientNameInput').value = '';
            document.getElementById('patientRoomInput').value = '';
            await loadRooms();
            await loadStats();
        } else {
            msgEl.innerHTML = `<span style="color: var(--accent-red);">❌ Error: ${data.error}</span>`;
        }
    } catch (e) {
        console.error('Grant access error:', e);
        msgEl.innerHTML = `<span style="color: var(--accent-red);">❌ Server error. Please try again.</span>`;
    }
}


// ============================================
// API CALLS
// ============================================
async function loadPatients() {
    try {
        const res = await fetch(`${API_BASE}/requests`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allRequests = await res.json();
        filterAndRender();
    } catch (e) {
        console.error('loadPatients error:', e);
        document.getElementById('patientContainer').innerHTML =
            `<div class="no-results" style="color:var(--accent-red);">Error: ${e.message}</div>`;
    }
}

async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        const stats = await res.json();
        document.getElementById('totalPatients').textContent = stats.total_patients || 0;
        document.getElementById('totalPending').textContent = stats.pending || 0;
        document.getElementById('totalAccepted').textContent = stats.accepted || 0;
        document.getElementById('totalWorkDone').textContent = stats.workdone || 0;
        document.getElementById('totalCancelled').textContent = stats.cancelled || 0;
        document.getElementById('totalStaff').textContent = stats.total_staff || 0;
        document.getElementById('availableStaff').textContent = stats.available_staff || 0;
    } catch (e) { console.error('loadStats error:', e); }
}

// ============================================
//  LOAD NOTIFICATIONS (with new notification detection)
// ============================================
let previousNotificationCount = 0;

async function loadNotifications() {
    try {
        const res = await fetch(`${API_BASE}/notifications`);
        const notifs = await res.json();
        const list = document.getElementById('notificationList');
        
        // Check if there are NEW notifications (unread count increased)
        const unreadCount = (notifs || []).filter(n => !n.is_read).length;
        const previousUnread = previousNotificationCount || 0;
        
        // If new notifications arrived, play a DING
        if (unreadCount > previousUnread && unreadCount > 0) {
            playDingSound();
            // Also show a subtle visual flash on the bell icon
            const bell = document.querySelector('.notification-icon');
            bell.style.animation = 'none';
            setTimeout(() => {
                bell.style.animation = 'pulse 0.5s ease 3';
            }, 10);
        }
        previousNotificationCount = unreadCount;

        if (!notifs || notifs.length === 0) {
            list.innerHTML = '<div class="no-notifications">No notifications</div>';
        } else {
            list.innerHTML = notifs.map(n => {
                // Determine status color for the notification
                let statusColor = '#3498db';
                if (n.message.includes('Accepted')) statusColor = '#2980b9';
                else if (n.message.includes('Completed')) statusColor = '#27ae60';
                else if (n.message.includes('Cancelled')) statusColor = '#e74c3c';
                
                return `
                    <div class="notification-item ${!n.is_read ? 'unread' : ''}" style="border-left-color: ${statusColor};">
                        <div class="notif-content">
                            <div class="notif-title">${n.title}</div>
                            <div class="notif-desc">${n.message}</div>
                        </div>
                        <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
                    </div>
                `;
            }).join('');
        }
        
        document.getElementById('notifCount').textContent = unreadCount;
    } catch (e) {
        console.error('loadNotifications error:', e);
    }
}
// ============================================
//  CLEAR ALL NOTIFICATIONS
// ============================================
async function clearAllNotifications() {
    if (!confirm('Are you sure you want to delete ALL notifications? This cannot be undone.')) {
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/notifications/clear-all`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            previousNotificationCount = 0;
            await loadNotifications();
            // Also update the badge
            document.getElementById('notifCount').textContent = '0';
            alert('✅ All notifications cleared.');
        } else {
            const data = await res.json();
            alert('❌ Failed to clear notifications: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('clearAllNotifications error:', e);
        alert('❌ Error clearing notifications.');
    }
}
// ============================================
//  REVOKE ACCESS (Supports room or patient name)
// ============================================
async function revokeAccess() {
    const roomInput = document.getElementById('revokeRoomInput').value.trim();
    const patientInput = document.getElementById('revokePatientInput').value.trim();
    const msgEl = document.getElementById('revokeAccessMessage');

    if (!roomInput && !patientInput) {
        msgEl.innerHTML = '<span style="color: var(--accent-red);">⚠️ Please enter either Room Number or Patient Name.</span>';
        return;
    }

    // If both are provided, use room number first (more precise)
    const searchTerm = roomInput || patientInput;
    const searchType = roomInput ? 'room' : 'patient';

    if (!confirm(`⚠️ Are you sure you want to revoke access for ${searchType === 'room' ? 'Room ' + searchTerm : 'patient ' + searchTerm}?`)) {
        return;
    }

    try {
        let room_no = roomInput;

        // If only patient name is provided, find their room first
        if (!roomInput && patientInput) {
            const res = await fetch(`${API_BASE}/patients/search?name=${encodeURIComponent(patientInput)}`);
            const data = await res.json();
            if (data.room) {
                room_no = data.room;
            } else {
                msgEl.innerHTML = `<span style="color: var(--accent-red);">❌ Patient "${patientInput}" not found.</span>`;
                return;
            }
        }

        const revokeRes = await fetch(`${API_BASE}/rooms/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_no: room_no })
        });
        const data = await revokeRes.json();

        if (revokeRes.ok) {
            msgEl.innerHTML = `<span style="color: var(--accent-green);">✅ ${data.message}</span>`;
            document.getElementById('revokeRoomInput').value = '';
            document.getElementById('revokePatientInput').value = '';
            await loadRooms();
            await loadStats();
        } else {
            msgEl.innerHTML = `<span style="color: var(--accent-red);">❌ Error: ${data.error}</span>`;
        }
    } catch (e) {
        console.error('Revoke access error:', e);
        msgEl.innerHTML = `<span style="color: var(--accent-red);">❌ Server error. Please try again.</span>`;
    }
}
async function loadActivityLogs() {
    const tbody = document.getElementById('logBody');
    if (!tbody) return;
    try {
        const res = await fetch(`${API_BASE}/activity-logs`);
        const logs = await res.json();
        if (!logs || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="log-empty">No activities recorded yet.</td></tr>`;
        } else {
            tbody.innerHTML = logs.map(log => `
                <tr>
                    <td>${log.date}</td>
                    <td>${log.day}</td>
                    <td>${log.time}</td>
                    <td class="action-cell">${log.action} ${log.patient_name ? '- ' + log.patient_name : ''}</td>
                </tr>
            `).join('');
        }
    } catch (e) {
        console.error('loadActivityLogs error:', e);
        tbody.innerHTML = `<tr><td colspan="4" class="log-empty">Could not load logs.</td></tr>`;
    }
}

// ============================================
// LOAD STAFF (with PRANK for Shreeyash Patil)
// ============================================
async function loadStaff() {
    try {
        const res = await fetch(`${API_BASE}/staff`);
        const staff = await res.json();
        const grid = document.getElementById('staffGrid');
        if (!grid) return;
        if (staff.length === 0) {
            grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);">No staff found.</p>';
            return;
        }

        grid.innerHTML = staff.map(s => {
            // ============================================
            // 🃏 PRANK: Shreeyash Patil gets a photo (optional)
            // ============================================
            let prankHtml = '';
            if (s.name === 'Phardmacist Shreeyash Patil') {
                prankHtml = `<img src="/static/images/friend.jpg" 
                                   alt="Shreeyash" 
                                   style="width: 80px; 
                                          height: 80px; 
                                          border-radius: 50%; 
                                          object-fit: cover; 
                                          border: 3px solid var(--accent-blue); 
                                          display: block; 
                                          margin: 0 auto 12px auto;
                                          box-shadow: 0 4px 12px rgba(0,0,0,0.15);">`;
            }
            // ============================================

            return `
                <div class="staff-card ${s.role.toLowerCase().replace(/\s+/g, '-')}">
                    ${prankHtml}
                    <div class="staff-name">${s.name}</div>
                    <div class="staff-role">${s.role}</div>
                    <div class="staff-department">${s.department || 'General'}</div>
                    <span class="staff-status ${s.available ? 'on-duty' : 'on-task'}">
                        ${s.available ? 'Available' : 'On Task'}
                    </span>
                </div>
            `;
        }).join('');
    } catch (e) { console.error('loadStaff error:', e); }
}
async function loadRooms() {
    const container = document.getElementById('roomListContainer');
    if (!container) return;

    try {
        const res = await fetch(`${API_BASE}/rooms`);
        const rooms = await res.json();

        if (!rooms || rooms.length === 0) {
            container.innerHTML = '<div class="log-empty">No rooms configured yet.</div>';
            return;
        }

        container.innerHTML = rooms.map(r => `
            <div class="log-entry" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <span style="font-weight: 500;">
                    🛏️ <strong>Room ${r.room_no}</strong> 
                    ${r.patient_name ? `- 👤 ${r.patient_name}` : '<span style="color: var(--text-muted);">(Unassigned)</span>'}
                </span>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="font-weight: 600; color: ${r.status === 'Active' ? 'var(--accent-green)' : 'var(--accent-red)'};">
                        ${r.status === 'Active' ? '🟢 Active' : '🔴 Inactive'}
                    </span>
                    <!-- Panel button removed -->
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Error loading rooms:', e);
        container.innerHTML = '<div class="log-empty">Could not load rooms.</div>';
    }
}
// ============================================
// ACTIONS (Accept / Complete / Reset)
// ============================================
async function updateStatus(reqId, action) {
    const statusMap = { accept: 'accepted', workdone: 'workdone', reset: 'pending' };
    const status = statusMap[action];
    if (!status) return;

    try {
        const res = await fetch(`${API_BASE}/requests/${reqId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            await refreshAll();
        } else {
            const err = await res.json();
            alert('Failed: ' + (err.error || err.message || 'Unknown error'));
        }
    } catch (e) {
        console.error('updateStatus error:', e);
        alert('Error updating status.');
    }
}

async function markAllAsRead() {
    try {
        await fetch(`${API_BASE}/notifications/mark-all-read`, { method: 'PUT' });
        await loadNotifications();
    } catch (e) { console.error(e); }
}

// ============================================
// UI HELPERS
// ============================================
function showPage(page) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const section = document.getElementById(`page${page.charAt(0).toUpperCase() + page.slice(1)}`);
    const btn = document.getElementById(`nav${page.charAt(0).toUpperCase() + page.slice(1)}`);
    if (section) section.classList.add('active');
    if (btn) btn.classList.add('active');
}

function toggleNotifications() {
    document.getElementById('notificationPanel').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('active');
}

function updateClock() {
    const el = document.getElementById('currentTime');
    if (el) el.textContent = new Date().toLocaleTimeString();
}

// ============================================
// REFRESH & INIT
// ============================================
async function refreshAll() {
    await Promise.all([
        loadPatients(),
        loadStats(),
        loadNotifications(),
        loadActivityLogs(),
        loadStaff(),
        loadRooms()
    ]);
}

function startAutoRefresh(seconds) {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        console.log('Auto-refresh...');
        refreshAll();
    }, seconds * 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
    loadThemePreference();

    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchQuery = e.target.value;
        filterAndRender();
    });

    document.getElementById('refreshRate').addEventListener('change', (e) => {
        startAutoRefresh(parseInt(e.target.value));
    });

    updateClock();
    setInterval(updateClock, 1000);

    await refreshAll();

    const defaultRate = parseInt(document.getElementById('refreshRate').value) || 10;
    startAutoRefresh(defaultRate);

    console.log('Dashboard ready.');
});