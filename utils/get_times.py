import re

chunks = []
with open(r'C:\Users\erlen\.gemini\antigravity\brain\b1897c51-0780-4d60-8714-9bd670ce61ec\.system_generated\tasks\task-4400.log', 'r', encoding='utf-8') as f:
    for line in f:
        if 'Opening parquet file:' in line:
            match = re.search(r'chunk_(\d+)_sorted.parquet', line)
            if match:
                chunks.append({'id': int(match.group(1)), 'rows': 0, 'time': 0.0})
        elif 'Bucketed' in line:
            match = re.search(r'Bucketed (\d+) rows in ([\d\.]+)s', line)
            if match and chunks:
                chunks[-1]['rows'] = int(match.group(1))
                chunks[-1]['time'] = float(match.group(2))

for c in chunks:
    if c['time'] > 0:
        print(f"Chunk {c['id']:02d}: {c['rows']:>11,} rows in {c['time']:>6.2f}s")
