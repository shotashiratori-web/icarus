// Food / Process / ProcessedProduct Knowledge Entity MVP（migration 0011）の型定義。
// Field Log/Work Log（事実の記録）とは別の、編集・確定された知識Entity。

export interface FoodEntity {
  id: string;
  canonicalName: string;
  aliases: string[];
  usableParts: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ProcessStep {
  order: number;
  text: string;
}

export interface ProcessEntity {
  id: string;
  name: string;
  description: string;
  steps: ProcessStep[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ProcessedProductEntity {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// Food Editor（create/edit共通フォーム）がAPIへ送るrequest型。id・createdBy・createdAt・updatedAtは
// Worker側で採番・設定するため含まない（SpotFormInputと同じ役割）
export interface FoodFormInput {
  canonicalName: string;
  aliases: string[];
  usableParts: string[];
  description: string;
}

export type KnowledgeEntityType = 'food' | 'process' | 'processed_product';
export type KnowledgeRelationType = 'uses' | 'produces';

export interface KnowledgeRelation {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
  createdAt: string;
  createdBy: string;
}

// Composite API（POST /knowledge/processes）の契約型。
// Process + Input(uses) + Output(produces) を1リクエストで送る。createdBy・IDはクライアントから送らない
// （Worker側で採番・設定する）。ProcessEditorScreen・knowledgeApi.tsで共有し、重複定義しない。
export interface CompositeProcessInput {
  type: 'food' | 'processed_product';
  id: string;
}

export type CompositeProcessOutput =
  | { mode: 'existing'; id: string }
  | { mode: 'create'; name: string; description: string };

export interface CompositeProcessRequest {
  process: {
    name: string;
    description: string;
    steps: ProcessStep[];
  };
  inputs: CompositeProcessInput[];
  outputs: CompositeProcessOutput[];
}

export interface CompositeProcessResponse {
  status: 'success';
  process: ProcessEntity;
  inputs: CompositeProcessInput[];
  outputs: ({ mode: 'existing'; id: string } | { mode: 'create'; id: string; name: string })[];
  relations: KnowledgeRelation[];
}
