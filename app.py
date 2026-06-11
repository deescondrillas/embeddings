# pip install flask flask-cors

from flask import Flask, request, jsonify
from flask_cors import CORS
from logic import search, get_all

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/products")
def products_route():
    try:
        results = get_all()
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
    q = request.args.get("q", "").strip()
    try:
        n = min(int(request.args.get("n", 24)), 100)
    except (ValueError, TypeError):
        n = 24

    if not q:
        return products_route()

    try:
        results = search(q, n)
        return jsonify([{
            "id":          r["id"],
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
    app.run(debug=True, port=5000)
