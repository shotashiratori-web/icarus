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
