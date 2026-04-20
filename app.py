import base64
import json
import os
import sqlite3
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    redirect,
    request,
    jsonify,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = BASE_DIR / "db.sqlite3"

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = "change-me-please"

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD_HASH = generate_password_hash("admin")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    UPLOAD_DIR.mkdir(exist_ok=True)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            photo_filename TEXT,
            face_descriptor TEXT,
            balance REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
        )
        """
    )
    cursor.execute("SELECT COUNT(*) AS count FROM users")
    row = cursor.fetchone()
    if row["count"] == 0:
        cursor.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (ADMIN_USERNAME, ADMIN_PASSWORD_HASH),
        )
    conn.commit()
    conn.close()


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if session.get("user") != ADMIN_USERNAME:
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)

    return wrapper


def row_to_dict(row):
    return {k: row[k] for k in row.keys()}


def save_base64_image(data_url: str, prefix: str = "photo") -> str:
    header, encoded = data_url.split(",", 1)
    data = base64.b64decode(encoded)
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    filename = f"{prefix}_{timestamp}.jpg"
    file_path = UPLOAD_DIR / filename
    file_path.write_bytes(data)
    return filename


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/session")
def session_status():
    return jsonify({"user": session.get("user")})


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid username or password"}), 401

    session["user"] = username
    return jsonify({"user": username})


@app.route("/api/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return jsonify({"success": True})


@app.route("/api/customers", methods=["GET"])
@login_required
def get_customers():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM customers ORDER BY name")
    rows = cursor.fetchall()
    conn.close()

    customers = []
    for row in rows:
        customer = row_to_dict(row)
        customer["face_descriptor"] = (
            json.loads(customer["face_descriptor"]) if customer["face_descriptor"] else None
        )
        customer["photo_url"] = (
            url_for("uploads", filename=customer["photo_filename"]) if customer["photo_filename"] else None
        )
        customers.append(customer)

    return jsonify(customers)


@app.route("/api/customers", methods=["POST"])
@login_required
def add_customer():
    data = request.json or {}
    name = data.get("name", "").strip()
    phone = data.get("phone")
    address = data.get("address")
    photo_data = data.get("photo_data")
    face_descriptor = data.get("face_descriptor")

    if not name:
        return jsonify({"error": "Name is required"}), 400

    photo_filename = None
    if photo_data:
        try:
            photo_filename = save_base64_image(photo_data, "customer")
        except Exception:
            return jsonify({"error": "Photo upload failed"}), 400

    conn = get_db()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        "INSERT INTO customers (name, phone, address, photo_filename, face_descriptor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            name,
            phone,
            address,
            photo_filename,
            json.dumps(face_descriptor) if face_descriptor else None,
            now,
            now,
        ),
    )
    conn.commit()
    customer_id = cursor.lastrowid
    conn.close()

    return jsonify({"id": customer_id, "success": True})


@app.route("/api/customers/<int:customer_id>", methods=["DELETE"])
@login_required
def delete_customer(customer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT photo_filename FROM customers WHERE id = ?", (customer_id,))
    row = cursor.fetchone()
    if row and row["photo_filename"]:
        photo_path = UPLOAD_DIR / row["photo_filename"]
        if photo_path.exists():
            photo_path.unlink()
    cursor.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/customers/<int:customer_id>/transactions", methods=["GET"])
@login_required
def get_transactions(customer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC",
        (customer_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    transactions = [row_to_dict(row) for row in rows]
    return jsonify(transactions)


@app.route("/api/customers/<int:customer_id>/transactions", methods=["POST"])
@login_required
def add_transaction(customer_id):
    data = request.json or {}
    tx_type = data.get("type")
    amount = data.get("amount")
    description = data.get("description")
    
    # Step 1: Frontend se bheja gaya 'created_at' haasil karein
    created_at = data.get("created_at")

    # Agar frontend se time nahi aaya, to fallback ke taur par server ka time use karein
    if not created_at:
        created_at = datetime.now().isoformat()


    if tx_type not in ("credit", "debit"):
        return jsonify({"error": "Invalid transaction type"}), 400

    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount"}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Step 2: Database mein 'created_at' variable ko istemal karein
    cursor.execute(
        "INSERT INTO transactions (customer_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)",
        (customer_id, tx_type, amount, description, created_at), # Yahan `created_at` use karein
    )

    if tx_type == "credit":
        cursor.execute(
            "UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?",
            (amount, created_at, customer_id), # Yahan bhi `created_at` use karein
        )
    else:
        cursor.execute(
            "UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?",
            (amount, created_at, customer_id), # Yahan bhi `created_at` use karein
        )

    conn.commit()
    conn.close()
    
    return jsonify({"success": True})



@app.route("/api/recognize", methods=["POST"])
@login_required
def recognize():
    data = request.json or {}
    descriptor = data.get("descriptor")
    if not descriptor or not isinstance(descriptor, list):
        return jsonify({"error": "Descriptor is required"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, face_descriptor FROM customers WHERE face_descriptor IS NOT NULL")
    rows = cursor.fetchall()
    conn.close()

    best_match = None
    best_score = 1.0
    for row in rows:
        known = json.loads(row["face_descriptor"])
        if not known:
            continue
        distance = sum((a - b) ** 2 for a, b in zip(known, descriptor)) ** 0.5
        if distance < best_score:
            best_score = distance
            best_match = {"id": row["id"], "name": row["name"], "score": distance}

    if best_match and best_score < 0.55:
        return jsonify({"match": best_match})
    return jsonify({"match": None})


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
