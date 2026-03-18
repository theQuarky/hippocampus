import * as tf from '@tensorflow/tfjs-node';
import { db, DEFAULT_MEMORY_DB } from './db';

const MODEL_ID_PREFIX = 'associative';
const MIN_SAMPLES_TO_TRAIN = 10;

export interface TrainingSample {
  queryEmbedding: number[];
  accessedConcepts: string[];
  timestamp: number;
}

export interface AssociativeMemory {
  model: tf.Sequential;
  conceptIndex: Map<string, number>;
  trainingBuffer: TrainingSample[];
  lastTrainedAt: number;
  trainedSamples: number;
}

type PersistedWeight = {
  shape: number[];
  data: number[];
};

type ConceptRow = {
  concept_id: string;
  member_chunks: string;
};

let associativeMemorySingleton: AssociativeMemory | null = null;

export function buildModel(numConcepts: number): tf.Sequential {
  const outputUnits = Math.max(1, numConcepts);
  const model = tf.sequential();
  model.add(tf.layers.dense({
    inputShape: [384],
    units: 256,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
  }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
  model.add(tf.layers.dense({ units: outputUnits, activation: 'sigmoid' }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });

  return model;
}

function modelId(database: string): string {
  return `${MODEL_ID_PREFIX}:${database || DEFAULT_MEMORY_DB}`;
}

function loadConceptIndex(database: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT concept_id
    FROM concepts
    WHERE database_id = ?
    ORDER BY concept_id ASC
  `).all(database) as Array<{ concept_id: string }>;

  const conceptIndex = new Map<string, number>();
  rows.forEach((row, index) => conceptIndex.set(row.concept_id, index));
  return conceptIndex;
}

async function serializeWeights(model: tf.Sequential): Promise<PersistedWeight[]> {
  const weights = model.getWeights();
  const serialized: PersistedWeight[] = [];

  for (const tensor of weights) {
    const values = Array.from(await tensor.data()) as number[];
    serialized.push({
      shape: [...tensor.shape],
      data: values,
    });
  }

  return serialized;
}

function deserializeWeights(payload: string): tf.Tensor[] {
  const parsed = JSON.parse(payload) as PersistedWeight[];
  if (!Array.isArray(parsed)) return [];

  return parsed.map(weight => tf.tensor(weight.data, weight.shape));
}

async function saveModelWeights(memory: AssociativeMemory, database: string, accuracy?: number): Promise<void> {
  const serialized = await serializeWeights(memory.model);
  db.prepare(`
    INSERT INTO associative_memory (model_id, weights_json, num_concepts, trained_on, last_trained, accuracy)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      weights_json = excluded.weights_json,
      num_concepts = excluded.num_concepts,
      trained_on = excluded.trained_on,
      last_trained = excluded.last_trained,
      accuracy = excluded.accuracy
  `).run(
    modelId(database),
    JSON.stringify(serialized),
    Math.max(1, memory.conceptIndex.size),
    memory.trainedSamples,
    memory.lastTrainedAt,
    typeof accuracy === 'number' ? accuracy : null,
  );
}

function buildChunkConceptMap(database: string): Map<string, string[]> {
  const rows = db.prepare(`
    SELECT concept_id, member_chunks
    FROM concepts
    WHERE database_id = ?
  `).all(database) as ConceptRow[];

  const map = new Map<string, string[]>();
  for (const row of rows) {
    let members: string[] = [];
    try {
      const parsed = JSON.parse(row.member_chunks);
      if (Array.isArray(parsed)) {
        members = parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch {
      members = [];
    }

    for (const chunkId of members) {
      if (!map.has(chunkId)) map.set(chunkId, []);
      map.get(chunkId)!.push(row.concept_id);
    }
  }

  return map;
}

export async function loadOrInitAssociativeMemory(database: string = DEFAULT_MEMORY_DB): Promise<AssociativeMemory> {
  const dbName = database || DEFAULT_MEMORY_DB;

  if (associativeMemorySingleton) {
    const currentConcepts = loadConceptIndex(dbName);
    if (currentConcepts.size === associativeMemorySingleton.conceptIndex.size) {
      associativeMemorySingleton.conceptIndex = currentConcepts;
      return associativeMemorySingleton;
    }

    associativeMemorySingleton.model.dispose();
    associativeMemorySingleton = null;
  }

  const conceptIndex = loadConceptIndex(dbName);
  const persisted = db.prepare(`
    SELECT weights_json, num_concepts, trained_on, last_trained
    FROM associative_memory
    WHERE model_id = ?
    LIMIT 1
  `).get(modelId(dbName)) as {
    weights_json: string;
    num_concepts: number;
    trained_on: number;
    last_trained: number;
  } | undefined;

  const model = buildModel(conceptIndex.size);
  let trainedSamples = 0;
  let lastTrainedAt = 0;

  if (persisted && persisted.num_concepts === Math.max(1, conceptIndex.size)) {
    try {
      const tensors = deserializeWeights(persisted.weights_json);
      if (tensors.length > 0) {
        model.setWeights(tensors);
      }
      for (const tensor of tensors) {
        tensor.dispose();
      }
      trainedSamples = persisted.trained_on ?? 0;
      lastTrainedAt = persisted.last_trained ?? 0;
    } catch {
      // Fall back to a fresh model if persisted weights are invalid.
    }
  }

  associativeMemorySingleton = {
    model,
    conceptIndex,
    trainingBuffer: [],
    lastTrainedAt,
    trainedSamples,
  };

  return associativeMemorySingleton;
}

export async function predictAssociativeScores(
  queryEmbedding: number[],
  database: string = DEFAULT_MEMORY_DB,
): Promise<{ conceptScores: Map<string, number>; mlpWeight: number; trainedSamples: number }> {
  const memory = await loadOrInitAssociativeMemory(database);
  const conceptScores = new Map<string, number>();

  if (memory.conceptIndex.size === 0) {
    return { conceptScores, mlpWeight: 0, trainedSamples: memory.trainedSamples };
  }

  const xs = tf.tensor2d([queryEmbedding]);
  const prediction = memory.model.predict(xs) as tf.Tensor;
  const values = Array.from(await prediction.data()) as number[];
  xs.dispose();
  prediction.dispose();

  for (const [conceptId, index] of memory.conceptIndex.entries()) {
    conceptScores.set(conceptId, values[index] ?? 0);
  }

  const mlpWeight = Math.min(0.15, 0.15 * (memory.trainedSamples / 100));
  return {
    conceptScores,
    mlpWeight,
    trainedSamples: memory.trainedSamples,
  };
}

export function conceptScoreForChunk(
  chunkId: string,
  conceptScores: Map<string, number>,
  chunkConceptMap: Map<string, string[]>,
): number {
  const conceptIds = chunkConceptMap.get(chunkId) ?? [];
  if (conceptIds.length === 0) return 0;

  let best = 0;
  for (const conceptId of conceptIds) {
    const score = conceptScores.get(conceptId) ?? 0;
    if (score > best) best = score;
  }
  return best;
}

export async function trainAssociativeMemory(
  since: number,
  database: string = DEFAULT_MEMORY_DB,
): Promise<{ trained: boolean; samples: number; accuracy?: number; trainedSamples: number }> {
  const dbName = database || DEFAULT_MEMORY_DB;
  const memory = await loadOrInitAssociativeMemory(dbName);

  if (memory.conceptIndex.size === 0) {
    return { trained: false, samples: 0, trainedSamples: memory.trainedSamples };
  }

  const rows = db.prepare(`
    SELECT chunk_ids, query_embedding, timestamp
    FROM co_access_events
    WHERE timestamp > ?
      AND database_id = ?
    ORDER BY timestamp ASC
  `).all(since, dbName) as Array<{ chunk_ids: string; query_embedding: string | null; timestamp: number }>;

  if (rows.length === 0) {
    return { trained: false, samples: 0, trainedSamples: memory.trainedSamples };
  }

  const chunkConceptMap = buildChunkConceptMap(dbName);
  const xsRows: number[][] = [];
  const ysRows: number[][] = [];

  for (const row of rows) {
    if (!row.query_embedding) continue;

    let queryEmbedding: number[];
    let chunkIds: string[];
    try {
      const parsedEmbedding = JSON.parse(row.query_embedding);
      if (!Array.isArray(parsedEmbedding) || parsedEmbedding.length !== 384) continue;
      queryEmbedding = parsedEmbedding.map(v => Number(v));

      const parsedChunkIds = JSON.parse(row.chunk_ids);
      if (!Array.isArray(parsedChunkIds)) continue;
      chunkIds = parsedChunkIds.filter((value): value is string => typeof value === 'string');
    } catch {
      continue;
    }

    const target = new Array(Math.max(1, memory.conceptIndex.size)).fill(0);
    for (const chunkId of chunkIds) {
      const concepts = chunkConceptMap.get(chunkId) ?? [];
      for (const conceptId of concepts) {
        const idx = memory.conceptIndex.get(conceptId);
        if (typeof idx === 'number') {
          target[idx] = 1;
        }
      }
    }

    if (!target.some(v => v > 0)) continue;

    xsRows.push(queryEmbedding);
    ysRows.push(target);
  }

  if (xsRows.length < MIN_SAMPLES_TO_TRAIN) {
    return { trained: false, samples: xsRows.length, trainedSamples: memory.trainedSamples };
  }

  const xs = tf.tensor2d(xsRows);
  const ys = tf.tensor2d(ysRows);

  const history = await memory.model.fit(xs, ys, {
    epochs: 3,
    batchSize: 8,
    shuffle: true,
    verbose: 0,
  });

  xs.dispose();
  ys.dispose();

  const accuracyHistory = history.history.accuracy as number[] | undefined;
  const accuracy = Array.isArray(accuracyHistory) && accuracyHistory.length > 0
    ? accuracyHistory[accuracyHistory.length - 1]
    : undefined;

  memory.trainedSamples += xsRows.length;
  memory.lastTrainedAt = Date.now();

  await saveModelWeights(memory, dbName, accuracy);

  return {
    trained: true,
    samples: xsRows.length,
    accuracy,
    trainedSamples: memory.trainedSamples,
  };
}

export function buildChunkConceptMembership(database: string = DEFAULT_MEMORY_DB): Map<string, string[]> {
  return buildChunkConceptMap(database || DEFAULT_MEMORY_DB);
}

export async function getAssociativeStatus(database: string = DEFAULT_MEMORY_DB): Promise<{ trainedSamples: number; influence: number }> {
  const memory = await loadOrInitAssociativeMemory(database);
  const influence = Math.min(0.15, 0.15 * (memory.trainedSamples / 100));
  return { trainedSamples: memory.trainedSamples, influence };
}
