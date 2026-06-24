// ============================================
// CONFIGURATION
// ============================================
const API_BASE = '/api';

// ============================================
// UI HELPER
// ============================================
function showMessage(message, type) {
    const el = document.getElementById('staffMessage');
    el.textContent = message;
    el.className = 'message ' + type;
    el.style.display = 'block';
}

// ============================================
// STAFF LOGIN
// ============================================
async function staffLogin() {
    const name = document.getElementById('staffName').value.trim();
    const password = document.getElementById('staffPassword').value.trim();

    if (!name || !password) {
        showMessage('Please enter name and password.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/staff/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name, password: password })
        });

        const data = await res.json();

        if (data.success) {
            showMessage(`Welcome back, ${data.name}! Redirecting...`, 'success');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        } else {
            showMessage('Login failed: ' + (data.error || 'Invalid credentials'), 'error');
        }
    } catch (e) {
        console.error('Staff login error:', e);
        showMessage('Server error. Please try again.', 'error');
    }
}

// ============================================
// STAFF SIGNUP
// ============================================
async function staffSignup() {
    const name = document.getElementById('staffName').value.trim();
    const role = document.getElementById('staffRole').value.trim();  // Now reads from text input
    const department = document.getElementById('staffDepartment').value.trim() || 'General';
    const password = document.getElementById('staffPassword').value.trim();

    if (!name || !role || !password) {
        showMessage('Please enter name, role, and password.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/staff/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                role: role,
                department: department,
                password: password
            })
        });

        const data = await res.json();

        if (data.success) {
            showMessage(`Account created! Welcome, ${data.name}!`, 'success');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        } else {
            showMessage('Signup failed: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        console.error('Staff signup error:', e);
        showMessage('Server error. Please try again.', 'error');
    }
}

// ============================================
// KEYBOARD SHORTCUT: Enter key submits login
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('staffPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            staffLogin();
        }
    });
});