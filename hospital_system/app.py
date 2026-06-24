from flask import Flask, render_template, request, jsonify, session, redirect
from flask_cors import CORS
from models import db, Patient, Staff, Request, Notification, ActivityLog, Room
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timezone
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///hospital.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'your-super-secret-key-change-this-in-production'

CORS(app, supports_credentials=True)
db.init_app(app)

with app.app_context():
    db.create_all()
    # Auto-seeding disabled – uncomment below if you want dummy data later
    # if Request.query.count() == 0:
    #     from seed import seed_database
    #     seed_database()

# ----------------------------------------------
# HELPER FUNCTIONS
# ----------------------------------------------

def get_required_role(request_type):
    mapping = {
        'Call Nurse': 'Nurse',
        'Food Request': 'Nurse',
        'Water Request': 'Nurse',
        'Medicine Request': 'Pharmacist',
        'Cleaning Request': 'Administrator',
        'Wheelchair Assist': 'Nurse',
        'Family Assist': 'Administrator',
        'Tech Support': 'Administrator',
        'EMERGENCY ALERT': 'Doctor'
    }
    return mapping.get(request_type, 'Nurse')  # Default fallback

def find_available_staff(role):
    return Staff.query.filter_by(role=role, available=True).first()

# ----------------------------------------------
# FRONTEND PAGES
# ----------------------------------------------

@app.route('/')
def landing_page():
    return render_template('login.html')

@app.route('/patient/panel')
def patient_panel():
    """Patient Web Panel – accessible only after patient login"""
    if 'user_id' not in session or session.get('role') != 'patient':
        return redirect('/')
    return render_template('patient_panel.html')

@app.route('/api/esp/status', methods=['POST'])
def esp_check_status():
    data = request.json
    room_no = data.get('room_no')

    if not room_no:
        return jsonify({'error': 'room_no is required'}), 400

    # Find the room
    room = Room.query.filter_by(room_no=room_no).first()
    
    if not room:
        return jsonify({
            'room_no': room_no,
            'active': False,
            'patient_name': None,
            'message': 'Room not configured'
        })

    # Check if room is active and has a patient assigned
    is_active = (room.status == 'Active' and room.patient_id is not None)
    patient_name = room.patient.name if room.patient else None

    return jsonify({
        'room_no': room_no,
        'active': is_active,
        'patient_name': patient_name,
        'message': 'Access granted' if is_active else 'Access denied'
    })


@app.route('/api/room-request/<room_no>', methods=['GET'])
def get_room_request(room_no):
    """Get the current active request (pending/accepted) for a room."""
    patient = Patient.query.filter_by(room=room_no).first()
    if not patient:
        return jsonify({'exists': False, 'patient_name': None})
    
    # Check for pending or accepted requests
    req = Request.query.filter_by(patient_id=patient.id).filter(Request.status.in_(['pending', 'accepted'])).first()
    if req:
        return jsonify({
            'exists': True,
            'patient_name': patient.name,
            'request_type': req.request_type,
            'status': req.status,
            'request_id': req.id
        })
    else:
        return jsonify({
            'exists': False,
            'patient_name': patient.name
        })


@app.route('/api/esp/request', methods=['POST'])
def esp_create_request():
    data = request.json
    room_no = data.get('room_no')
    request_type = data.get('request_type')

    if not room_no or not request_type:
        return jsonify({'error': 'room_no and request_type are required'}), 400

    # Find patient by room
    patient = Patient.query.filter_by(room=room_no).first()
    if not patient:
        return jsonify({'error': f'No patient found in Room {room_no}'}), 404

    # ============================================
    #  🔥 SPAM PREVENTION: Check for existing request
    # ============================================
    existing_request = Request.query.filter_by(
        patient_id=patient.id
    ).filter(
        Request.status.in_(['pending', 'accepted'])
    ).first()

    if existing_request:
        return jsonify({
            'error': f'A request is already in progress for Room {room_no}. Please wait for it to be completed.',
            'existing_request_id': existing_request.id,
            'existing_status': existing_request.status
        }), 409  # 409 Conflict

    # Check if room is active
    room = Room.query.filter_by(room_no=room_no).first()
    if room and room.status != 'Active':
        return jsonify({'error': f'Room {room_no} is currently inactive.'}), 403

    # Create the request
    new_request = Request(
        patient_id=patient.id,
        request_type=request_type,
        priority='high' if request_type == 'EMERGENCY ALERT' else 'normal',
        status='pending'
    )
    db.session.add(new_request)
    db.session.commit()

    # Create notification
    notif = Notification(
        request_id=new_request.id,
        title=f"{patient.name} - {request_type}",
        message=f"Room {room_no} needs assistance.",
        is_read=False
    )
    db.session.add(notif)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': 'Request sent to staff!',
        'request_id': new_request.id
    }), 201
@app.route('/dashboard')
def staff_dashboard():
    # if 'user_id' not in session or session.get('role') != 'staff':
    #     return redirect('/')
    return render_template('index.html')

@app.route('/patient/dashboard')
def patient_dashboard():
    # Placeholder
    return render_template('index.html')

# ----------------------------------------------
# AUTHENTICATION ROUTES
# ----------------------------------------------
from models import Room  # Make sure this is imported at the top

# ============================================
# API: PATIENT ACCESS MANAGEMENT (Rooms)
# ============================================

@app.route('/api/rooms', methods=['GET'])
def get_rooms():
    rooms = Room.query.all()
    return jsonify([{
        'id': r.id,
        'room_no': r.room_no,
        'patient_name': r.patient.name if r.patient else None,
        'patient_id': r.patient_id,
        'status': r.status
    } for r in rooms])

@app.route('/api/rooms/grant', methods=['POST'])
def grant_access():
    data = request.json
    name = data.get('name')
    room_no = data.get('room_no')

    if not name or not room_no:
        return jsonify({'error': 'Patient name and room number are required.'}), 400

    # Find or create patient
    patient = Patient.query.filter_by(name=name).first()
    if not patient:
        patient = Patient(
            name=name,
            room=room_no,
            password_hash=generate_password_hash('default123')
        )
        db.session.add(patient)
        db.session.commit()

    # Find or create room
    room = Room.query.filter_by(room_no=room_no).first()
    if room:
        # 🔥 If room exists, just reactivate it – keep patient_id
        room.status = 'Active'
        room.updated_at = datetime.now(timezone.utc)
        # If patient changed, update it (optional)
        room.patient_id = patient.id
    else:
        room = Room(
            room_no=room_no,
            patient_id=patient.id,
            status='Active'
        )
        db.session.add(room)

    db.session.commit()
    return jsonify({'success': True, 'message': f'Access granted for {name} in Room {room_no}'}), 200

@app.route('/api/rooms/revoke', methods=['POST'])
def revoke_access():
    data = request.json
    room_no = data.get('room_no')

    if not room_no:
        return jsonify({'error': 'Room number is required.'}), 400

    room = Room.query.filter_by(room_no=room_no).first()
    if not room:
        return jsonify({'error': 'Room not found.'}), 404

    # 🔥 FIX: ONLY set status to 'Inactive' – KEEP patient_id
    room.status = 'Inactive'
    room.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify({'success': True, 'message': f'Room {room_no} deactivated. Patient remains assigned.'}), 200
@app.route('/api/patient/register', methods=['POST'])
def patient_register():
    data = request.json
    name = data.get('name')
    room = data.get('room')
    password = data.get('password')
    if not name or not room or not password:
        return jsonify({'error': 'Name, room, and password are required.'}), 400
    if Patient.query.filter_by(name=name).first():
        return jsonify({'error': 'Patient already exists.'}), 400
    hashed = generate_password_hash(password)
    patient = Patient(name=name, room=room, password_hash=hashed)
    db.session.add(patient)
    db.session.commit()
    session['user_id'] = patient.id
    session['role'] = 'patient'
    session['name'] = patient.name
    return jsonify({'success': True, 'patient_id': patient.id, 'name': patient.name, 'room': patient.room}), 201

@app.route('/api/patient/login', methods=['POST'])
def patient_login():
    data = request.json
    patient = Patient.query.filter_by(name=data.get('username')).first()
    if patient and patient.password_hash and check_password_hash(patient.password_hash, data.get('password')):
        session['user_id'] = patient.id
        session['role'] = 'patient'
        session['name'] = patient.name
        return jsonify({'success': True, 'patient_id': patient.id, 'name': patient.name})
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/staff/register', methods=['POST'])
def staff_register():
    data = request.json
    name = data.get('name')
    role = data.get('role')
    department = data.get('department')
    password = data.get('password')
    if not name or not role or not password:
        return jsonify({'error': 'Name, role, and password required.'}), 400
    if Staff.query.filter_by(name=name).first():
        return jsonify({'error': 'Staff name already exists.'}), 400
    hashed = generate_password_hash(password)
    staff = Staff(
        name=name,
        role=role,
        department=department or 'General',
        available=True,
        password_hash=hashed
    )
    db.session.add(staff)
    db.session.commit()
    return jsonify({'success': True, 'staff_id': staff.id, 'name': staff.name, 'role': staff.role}), 201

@app.route('/api/staff/login', methods=['POST'])
def staff_login():
    data = request.json
    staff = Staff.query.filter_by(name=data.get('username')).first()
    if not staff:
        return jsonify({'error': 'Invalid credentials'}), 401
    if not staff.password_hash:
        return jsonify({'error': 'Account setup incomplete. Contact admin.'}), 401
    if check_password_hash(staff.password_hash, data.get('password')):
        session['user_id'] = staff.id
        session['role'] = 'staff'
        session['name'] = staff.name
        return jsonify({'success': True, 'staff_id': staff.id, 'name': staff.name})
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/me', methods=['GET'])
def get_current_user():
    if 'user_id' in session:
        return jsonify({
            'logged_in': True,
            'user_id': session['user_id'],
            'role': session.get('role'),
            'name': session.get('name')
        })
    return jsonify({'logged_in': False}), 401

# ----------------------------------------------
# PATIENT REQUEST
# ----------------------------------------------

@app.route('/api/patient/request', methods=['POST'])
def patient_create_request():
    if 'user_id' not in session or session.get('role') != 'patient':
        return jsonify({'error': 'Please log in as patient'}), 401
    data = request.json
    req = Request(
        patient_id=session['user_id'],
        request_type=data.get('request_type'),
        priority='high' if data.get('request_type') == 'Emergency' else 'normal',
        status='pending'
    )
    db.session.add(req)
    db.session.commit()
    notif = Notification(
        request_id=req.id,
        title=f"{req.patient.name} - {req.request_type}",
        message=f"Room {req.patient.room} needs assistance.",
        is_read=False
    )
    db.session.add(notif)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Request sent!'})

# ----------------------------------------------
# STAFF DASHBOARD APIs
# ----------------------------------------------

@app.route('/api/requests', methods=['GET'])
def get_requests():
    reqs = Request.query.order_by(Request.created_at.desc()).all()
    return jsonify([{
        'id': r.id,
        'patient_name': r.patient.name if r.patient else 'Unknown',
        'room': r.patient.room if r.patient else 'N/A',
        'request_type': r.request_type,
        'assigned_staff': r.assigned_staff.name if r.assigned_staff else 'Unassigned',
        'status': r.status,
        'status_time': r.updated_at.strftime('%Y-%m-%d %H:%M:%S'),
        'priority': r.priority
    } for r in reqs])

@app.route('/api/requests/<int:req_id>/status', methods=['PUT'])
def update_request_status(req_id):
    data = request.json
    new_status = data.get('status')
    req = Request.query.get_or_404(req_id)
    old_status = req.status

    if old_status == new_status:
        return jsonify({'success': True, 'message': 'Status already set'}), 200

    action_desc = ""
    performed_by = "System"

    if new_status == 'accepted':
        role = get_required_role(req.request_type)
        staff = find_available_staff(role)
        if not staff:
            return jsonify({'error': f'No available {role}'}), 400
        req.assigned_staff_id = staff.id
        staff.available = False
        db.session.add(staff)
        action_desc = f"Assigned to {staff.name}"
        performed_by = staff.name

    elif new_status == 'workdone':
        if req.assigned_staff:
            req.assigned_staff.available = True
            db.session.add(req.assigned_staff)
            action_desc = f"Completed by {req.assigned_staff.name}"
            performed_by = req.assigned_staff.name
        else:
            action_desc = "Completed (Unassigned)"

    elif new_status == 'pending':
        if req.assigned_staff:
            req.assigned_staff.available = True
            db.session.add(req.assigned_staff)
            performed_by = req.assigned_staff.name
        action_desc = "Reset to pending"

    req.status = new_status
    req.updated_at = datetime.now(timezone.utc)

    log = ActivityLog(
        request_id=req_id,
        action=action_desc,
        old_status=old_status,
        new_status=new_status,
        performed_by=performed_by,
        created_at=datetime.now(timezone.utc)
    )
    db.session.add(log)

    notif = Notification(
        request_id=req_id,
        title=f"{req.patient.name} - {req.request_type}",
        message=f"Status: {new_status}",
        is_read=False
    )
    db.session.add(notif)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/requests/<int:req_id>/cancel', methods=['PUT'])
def cancel_request(req_id):
    req = Request.query.get_or_404(req_id)
    if req.status != 'workdone':
        return jsonify({'error': 'Only completed requests can be cancelled.'}), 400
    performed_by = "System"
    if req.assigned_staff:
        req.assigned_staff.available = True
        db.session.add(req.assigned_staff)
        performed_by = req.assigned_staff.name
    req.status = 'cancelled'
    req.updated_at = datetime.now(timezone.utc)
    log = ActivityLog(
        request_id=req_id,
        action=f"Cancelled by {performed_by}",
        old_status='workdone',
        new_status='cancelled',
        performed_by=performed_by,
        created_at=datetime.now(timezone.utc)
    )
    db.session.add(log)
    notif = Notification(
        request_id=req_id,
        title=f"{req.patient.name} - Cancelled",
        message=f"Cancelled by {performed_by}",
        is_read=False
    )
    db.session.add(notif)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/requests/<int:req_id>', methods=['DELETE'])
def delete_request(req_id):
    req = Request.query.get_or_404(req_id)
    Notification.query.filter_by(request_id=req_id).delete()
    ActivityLog.query.filter_by(request_id=req_id).delete()
    db.session.delete(req)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/stats', methods=['GET'])
def get_stats():
    return jsonify({
        'total_patients': Request.query.count(),
        'pending': Request.query.filter_by(status='pending').count(),
        'accepted': Request.query.filter_by(status='accepted').count(),
        'workdone': Request.query.filter_by(status='workdone').count(),
        'cancelled': Request.query.filter_by(status='cancelled').count(),
        'total_staff': Staff.query.count(),
        'available_staff': Staff.query.filter_by(available=True).count()
    })


@app.route('/room-panel/<room_no>')
def room_panel(room_no):
    """Display the patient panel for a specific room (staff can view/test)"""
    return render_template('patient_panel.html', room_no=room_no)


@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    notifs = Notification.query.order_by(Notification.created_at.desc()).limit(20).all()
    return jsonify([{
        'id': n.id,
        'title': n.title,
        'message': n.message,
        'is_read': n.is_read,
        'created_at': n.created_at.strftime('%Y-%m-%d %H:%M:%S')
    } for n in notifs])

@app.route('/api/notifications/mark-all-read', methods=['PUT'])
def mark_all_read():
    Notification.query.update({'is_read': True})
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/staff', methods=['GET'])
def get_staff_list():
    staff = Staff.query.all()
    return jsonify([{
        'id': s.id,
        'name': s.name,
        'role': s.role,
        'department': s.department,
        'available': s.available
    } for s in staff])

@app.route('/api/activity-logs', methods=['GET'])
def get_activity_logs():
    logs = ActivityLog.query.order_by(ActivityLog.id.desc()).limit(20).all()
    return jsonify([{
        'id': l.id,
        'action': l.action,
        'patient_name': l.request.patient.name if l.request and l.request.patient else None,
        'date': l.created_at.strftime('%d-%m-%Y'),
        'day': l.created_at.strftime('%A'),
        'time': l.created_at.strftime('%I:%M:%S %p')
    } for l in logs])


@app.route('/api/patients/search', methods=['GET'])
def search_patient():
    name = request.args.get('name')
    if not name:
        return jsonify({'error': 'Name parameter required'}), 400
    patient = Patient.query.filter_by(name=name).first()
    if patient:
        return jsonify({'name': patient.name, 'room': patient.room, 'id': patient.id})
    return jsonify({'error': 'Patient not found'}), 404

@app.route('/api/reset', methods=['POST'])
def reset_data():
    if not app.debug:
        return jsonify({'error': 'Not allowed in production'}), 403
    try:
        db.session.query(ActivityLog).delete()
        db.session.query(Notification).delete()
        db.session.query(Request).delete()
        db.session.query(Patient).delete()
        db.session.query(Staff).delete()
        db.session.commit()
        from seed import seed_database
        seed_database()
        return jsonify({'success': True, 'message': 'Reset done'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/notifications/clear-all', methods=['DELETE'])
def clear_all_notifications():
    """Delete all notifications (for the 'Clear All' button)"""
    try:
        Notification.query.delete()
        db.session.commit()
        return jsonify({'success': True, 'message': 'All notifications cleared.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
if __name__ == '__main__':
    print("=" * 50)
    print(" Starting Flask server on http://localhost:5000")
    print("Landing Page:  http://localhost:5000/")
    print("Staff Dashboard: http://localhost:5000/dashboard")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=5000)