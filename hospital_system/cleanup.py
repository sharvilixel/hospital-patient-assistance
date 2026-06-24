from app import app, db
from models import Request

with app.app_context():
    Request.query.delete()
    db.session.commit()
    print("All requests deleted.")