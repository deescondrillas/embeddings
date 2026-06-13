# pip install kaggle kagglehub rapidfuzz

import pandas as pd
import numpy as np
import kagglehub
import threading

from sentence_transformers import SentenceTransformer
from pymilvus import MilvusClient, DataType
from kagglehub import KaggleDatasetAdapter
from rapidfuzz import process, fuzz, utils as fuzz_utils

EMBEDDING_MODEL = "paraphrase-multilingual-mpnet-base-v2"
DB_PATH         = "./ikea_products.db"
COLLECTION_NAME = "ikea_products"
EMBEDDING_DIM   = 768
VARCHAR_MAX     = 512
DEFAULT_TOP_N   = 24

_progress   = {"stage": "starting", "pct": 0, "label": "Starting…", "ready": False, "error": None}
_init_done  = threading.Event()
_client     = None
_model      = None
_name_index = []  # list of all product records, used for fuzzy name search


def get_progress():
    return dict(_progress)


def _set(stage, pct, label):
    _progress.update({"stage": stage, "pct": pct, "label": label})


def _init():
    global _client, _model
    try:
        _set("model", 5, "Loading embedding model…")
        _model = SentenceTransformer(EMBEDDING_MODEL)

        _set("db", 18, "Connecting to database…")
        _client = MilvusClient(DB_PATH)

        if not _client.has_collection(COLLECTION_NAME):
            _set("download", 22, "Downloading IKEA dataset…")
            df = kagglehub.dataset_load(
                KaggleDatasetAdapter.PANDAS, "thedevastator/ikea-product", "ikea.csv"
            )

            _set("clean", 36, f"Cleaning {len(df)} products…")
            df = df[["item_id", "name", "category", "price", "short_description", "link"]].copy()
            df = df.dropna(subset=["name", "short_description"], how="all").reset_index(drop=True)
            for col in ["name", "category", "short_description", "link"]:
                df[col] = df[col].fillna("").astype(str).str.strip()
            df["price"] = pd.to_numeric(df["price"], errors="coerce").fillna(0.0).astype(float)
            df = df.groupby(
                ["name", "price", "short_description"], as_index=False
            ).agg(
                item_id=("item_id", "first"),
                category=("category", lambda x: " · ".join(dict.fromkeys(v for v in x if v))),
                link=("link", "first"),
            )
            for col in ["name", "category", "short_description", "link"]:
                df[col] = df[col].str[:VARCHAR_MAX]
            df["text"]  = df["name"] + " " + df["short_description"]

            # Encode in batches so the frontend can show real progress (45% → 80%)
            texts      = df["text"].tolist()
            total      = len(texts)
            batch_size = 64
            chunks     = []
            for i in range(0, total, batch_size):
                chunks.append(
                    _model.encode(texts[i : i + batch_size],
                                  show_progress_bar=False, convert_to_numpy=True)
                )
                done = min(i + batch_size, total)
                _set("embed", 45 + int(done / total * 35),
                     f"Computing embeddings… {done} / {total}")
            embeddings = np.vstack(chunks)

            _set("schema", 82, "Creating collection…")
            schema = MilvusClient.create_schema(auto_id=False, enable_dynamic_field=False)
            schema.add_field("product_id",        DataType.INT64,         is_primary=True)
            schema.add_field("embedding",         DataType.FLOAT_VECTOR,  dim=EMBEDDING_DIM)
            schema.add_field("name",              DataType.VARCHAR,        max_length=VARCHAR_MAX)
            schema.add_field("category",          DataType.VARCHAR,        max_length=VARCHAR_MAX)
            schema.add_field("short_description", DataType.VARCHAR,        max_length=VARCHAR_MAX)
            schema.add_field("link",              DataType.VARCHAR,        max_length=VARCHAR_MAX)
            schema.add_field("price",             DataType.FLOAT)

            index_params = _client.prepare_index_params()
            index_params.add_index(
                field_name="embedding",
                index_type="HNSW",
                metric_type="COSINE",
                params={"M": 16, "efConstruction": 200},
            )
            _client.create_collection(
                collection_name=COLLECTION_NAME,
                schema=schema,
                index_params=index_params,
            )

            _set("insert", 90, f"Inserting {len(df)} records…")
            records = [
                {
                    "product_id":        int(row["item_id"]),
                    "embedding":         embeddings[idx].tolist(),
                    "name":              row["name"],
                    "category":          row["category"],
                    "short_description": row["short_description"],
                    "link":              row["link"],
                    "price":             float(row["price"]),
                }
                for idx, row in df.iterrows()
            ]
            _client.insert(collection_name=COLLECTION_NAME, data=records)

        _client.load_collection(COLLECTION_NAME)

        _set("index", 98, "Building name index…")
        _build_name_index()

        _set("ready", 100, "Catalog ready")
        _progress["ready"] = True

    except Exception as e:
        _progress["error"] = str(e)
        _progress["label"] = f"Error: {e}"
    finally:
        _init_done.set()


threading.Thread(target=_init, daemon=True).start()


def _build_name_index():
    global _name_index
    try:
        stats = _client.get_collection_stats(COLLECTION_NAME)
        total = int(stats.get("row_count", 2000))
    except Exception:
        total = 2000
    _name_index = _client.query(
        collection_name=COLLECTION_NAME,
        filter="product_id > 0",
        output_fields=["product_id", "name", "category", "short_description", "link", "price"],
        limit=total,
    )


def get_all():
    _init_done.wait()
    if _progress.get("error"):
        raise RuntimeError(_progress["error"])
    try:
        stats = _client.get_collection_stats(COLLECTION_NAME)
        total = int(stats.get("row_count", 2000))
    except Exception:
        total = 2000
    results = _client.query(
        collection_name=COLLECTION_NAME,
        filter="product_id > 0",
        output_fields=["product_id", "name", "category", "short_description", "link", "price"],
        limit=total,
    )
    return sorted(results, key=lambda r: (r.get("name") or "").lower())


def search(query: str, n: int = DEFAULT_TOP_N):
    _init_done.wait()
    if _progress.get("error"):
        raise RuntimeError(_progress["error"])
    query_vector = _model.encode([query])[0].tolist()
    results = _client.search(
        collection_name=COLLECTION_NAME,
        data=[query_vector],
        limit=n,
        output_fields=["name", "category", "short_description", "link", "price"],
    )
    return results[0]


def search_by_name(query: str, n: int = DEFAULT_TOP_N):
    _init_done.wait()
    if _progress.get("error"):
        raise RuntimeError(_progress["error"])
    names = [r["name"] for r in _name_index]
    matches = process.extract(
        query, names,
        scorer=fuzz.WRatio,
        processor=fuzz_utils.default_process,
        limit=n,
    )
    results = []
    for _matched_name, score, idx in matches:
        r = _name_index[idx]
        results.append({
            "product_id":        r["product_id"],
            "name":              r["name"],
            "category":          r["category"],
            "short_description": r["short_description"],
            "link":              r["link"],
            "price":             r["price"],
            "distance":          round(1 - score / 100, 4),
        })
    return results


def show_results(results):
    for i, hit in enumerate(results, start=1):
        e = hit["entity"]
        print(f"{i}. {e['name']}")
        print(f"   Category:    {e['category']}")
        print(f"   Description: {e['short_description']}")
        print(f"   Price:       ${e['price']:.2f}")
        print(f"   Similarity:  {hit['distance']:.4f}")
        print(f"   Link:        {e['link']}\n")
