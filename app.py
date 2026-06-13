# pip install flask flask_cors

import os
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import logic
import json
import time

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/ping")
def ping_route():
    return jsonify({"ok": True})


@app.route("/api/status")
def status_route():
    def generate():
        while True:
            p = logic.get_progress()
            yield f"data: {json.dumps(p)}\n\n"
            if p.get("ready") or p.get("error"):
                break
            time.sleep(0.4)
    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/products")
def products_route():
    try:
        results = logic.get_all()
        return jsonify([{
            "id":          r["product_id"],
            "name":        r["name"],
            "category":    r["category"],
            "description": r["short_description"],
            "price":       r["price"],
            "link":        r["link"],
            "similarity":  None,
        } for r in results])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/search")
def search_route():
    q    = request.args.get("q", "").strip()
    mode = request.args.get("mode", "semantic")
    try:
        n = min(int(request.args.get("n", 24)), 100)
    except (ValueError, TypeError):
        n = 24

    if not q:
        return products_route()

    try:
        if mode == "name":
            results = logic.search_by_name(q, n)
            return jsonify([{
                "id":          r["product_id"],
                "name":        r["name"],
                "category":    r["category"],
                "description": r["short_description"],
                "price":       r["price"],
                "link":        r["link"],
                "similarity":  r["distance"],
            } for r in results])
        else:
            results = logic.search(q, n)
            return jsonify([{
                "id":          r["product_id"],
                "name":        r["entity"]["name"],
                "category":    r["entity"]["category"],
                "description": r["entity"]["short_description"],
                "price":       r["entity"]["price"],
                "link":        r["entity"]["link"],
                "similarity":  round(r["distance"], 4),
            } for r in results])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False, port=5000)
