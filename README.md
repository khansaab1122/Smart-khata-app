# Face Khata Buddy - HTML/CSS/JS + Python

This is a plain HTML/CSS/JavaScript frontend with a Python Flask backend version of the Smart Khata app.

## Setup

1. Create a Python virtual environment:

```bash
python -m venv venv
```

2. Activate the environment:

```powershell
venv\Scripts\Activate.ps1
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Run the app:

```bash
python app.py
```

5. Open in browser:

```text
http://127.0.0.1:5000/
```

## Login

- Username: `admin`
- Password: `admin`

## Notes

- Customer photos are saved in `uploads/`.
- Face recognition uses browser camera and face-api.js models loaded from CDN.
