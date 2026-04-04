import sys
import json
from datasets import Dataset
from ragas import evaluate
from ragas.metrics import faithfulness, context_precision, answer_relevancy, context_recall

def main(json_file_path: str):
    """Run RAGAS evaluation on exported RAG results."""
    with open(json_file_path) as f:
        data = json.load(f)
    
    # Expected format:
    # [{ "question": str, "contexts": [str], "answer": str, "ground_truths": [str] }]
    
    ds = Dataset.from_list(data)
    
    metrics = [faithfulness, context_precision, answer_relevancy, context_recall]
    results = evaluate(ds, metrics=metrics)
    
    print(json.dumps({
        "faithfulness": float(results["faithfulness"]),
        "context_precision": float(results["context_precision"]),
        "answer_relevancy": float(results["answer_relevancy"]),
        "context_recall": float(results["context_recall"]),
    }, indent=2))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python evaluate_rag.py <path_to_eval_data.json>")
        sys.exit(1)
    main(sys.argv[1])
