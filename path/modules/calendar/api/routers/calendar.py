from flask import Blueprint, jsonify
from flask_sqlalchemy import SQLAlchemy

blueprint = Blueprint('calendar', __name__)
db = SQLAlchemy()

@blueprint.route('/calendars')
def get_calendars():
    calendars = db.session.query(Calendar).all()
    return jsonify([calendar.to_dict() for calendar in calendars])

class Calendar(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    color = db.Column(db.String(10), nullable=False)

    def to_dict(self):
        return {'id': self.id, 'name': self.name, 'color': self.color}