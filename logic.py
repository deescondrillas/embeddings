# pip install sentence-transformers "pymilvus[model,milvus_lite]"

import pandas as pd
import kagglehub

from sentence_transformers import SentenceTransformer
from pymilvus import MilvusClient, DataType
from kagglehub import KaggleDatasetAdapter

DB_PATH         = "./ikea_products.db"
EMBEDDING_MODEL = "paraphrase-multilingual-mpnet-base-v2"
COLLECTION_NAME = "ikea_products"
EMBEDDING_DIM   = 768
VARCHAR_MAX     = 512
DEFAULT_TOP_N   = 24

embedding_model = SentenceTransformer(EMBEDDING_MODEL)
client = MilvusClient(DB_PATH)

if not client.has_collection(COLLECTION_NAME):
    file_path = "ikea.csv"
    df = kagglehub.dataset_load(KaggleDatasetAdapter.PANDAS, "thedevastator/ikea-product", file_path)
    print(f"Dataset loaded: {len(df)} products")

    df = df[["item_id", "name", "category", "price", "short_description", "link"]].copy()
    df = df.groupby(
        ["item_id", "name", "price", "short_description", "link"], as_index=False
    )["category"].agg(lambda x: ", ".join(x.unique()))

    df = df.dropna(subset=["name", "short_description"], how="all").reset_index(drop=True)
    for col in ["name", "category", "short_description", "link"]:
        df[col] = df[col].fillna("").astype(str).str[:VARCHAR_MAX]
    df["price"] = pd.to_numeric(df["price"], errors="coerce").fillna(0.0).astype(float)
    df["text"] = df["name"] + " " + df["short_description"]

    print(f"After cleaning: {len(df)} products")

    embeddings = embedding_model.encode(
        df["text"].tolist(), show_progress_bar=True, convert_to_numpy=True
    )
    print(f"Embedding shape: {embeddings.shape}")

    schema = MilvusClient.create_schema(auto_id=False, enable_dynamic_field=False)
    schema.add_field("product_id", DataType.INT64, is_primary=True)
    schema.add_field("embedding", DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM)
    schema.add_field("name", DataType.VARCHAR, max_length=VARCHAR_MAX)
    schema.add_field("category", DataType.VARCHAR, max_length=VARCHAR_MAX)
    schema.add_field("short_description", DataType.VARCHAR, max_length=VARCHAR_MAX)
    schema.add_field("link", DataType.VARCHAR, max_length=VARCHAR_MAX)
    schema.add_field("price", DataType.FLOAT)

    index_params = client.prepare_index_params()
    index_params.add_index(
        field_name="embedding",
        index_type="HNSW",
        metric_type="COSINE",
        params={"M": 16, "efConstruction": 200},
    )

    client.create_collection(
        collection_name=COLLECTION_NAME,
        schema=schema,
        index_params=index_params,
    )
    print(f"Collection '{COLLECTION_NAME}' created.")

    records = [
        {
            "product_id": int(row["item_id"]),
            "embedding": embeddings[idx].tolist(),
            "name": row["name"],
            "category": row["category"],
            "short_description": row["short_description"],
            "link": row["link"],
            "price": float(row["price"]),
        }
        for idx, row in df.iterrows()
    ]

    client.insert(collection_name=COLLECTION_NAME, data=records)
    print(f"{len(records)} records inserted.")


def get_all():
    try:
        stats = client.get_collection_stats(COLLECTION_NAME)
        total = int(stats.get("row_count", 2000))
    except Exception:
        total = 2000
    results = client.query(
        collection_name=COLLECTION_NAME,
        filter="product_id > 0",
        output_fields=["product_id", "name", "category", "short_description", "link", "price"],
        limit=total,
    )
    return sorted(results, key=lambda r: (r.get("name") or "").lower())


def search(query: str, n: int = DEFAULT_TOP_N):
    query_vector = embedding_model.encode([query])[0].tolist()
    results = client.search(
        collection_name=COLLECTION_NAME,
        data=[query_vector],
        limit=n,
        output_fields=["name", "category", "short_description", "link", "price"],
    )
    return results[0]


def show_results(results):
    for i, hit in enumerate(results, start=1):
        e = hit["entity"]
        print(f"{i}. {e['name']}")
        print(f"   Category:    {e['category']}")
        print(f"   Description: {e['short_description']}")
        print(f"   Price:       ${e['price']:.2f}")
        print(f"   Similarity:  {hit['distance']:.4f}")
        print(f"   Link:        {e['link']}\n")
