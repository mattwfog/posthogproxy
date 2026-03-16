export interface Project {
  readonly id: number;
  readonly name: string;
  readonly organization: string;
  readonly created_at: string;
}

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface Person {
  readonly id: number;
  readonly distinct_ids: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export interface Event {
  readonly id: string;
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

export interface FeatureFlag {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly active: boolean;
  readonly rollout_percentage: number | null;
  readonly filters: Readonly<Record<string, unknown>>;
}

export interface Dashboard {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly created_at: string;
  readonly last_accessed_at: string | null;
}

export interface TrendResult {
  readonly labels: readonly string[];
  readonly data: readonly number[];
  readonly label: string;
  readonly count: number;
}

export interface FunnelStep {
  readonly name: string;
  readonly count: number;
  readonly conversion_rate: number;
}

export interface QueryResult {
  readonly columns: readonly string[];
  readonly results: readonly (readonly unknown[])[];
  readonly hasMore?: boolean;
}

export interface PaginatedResponse<T> {
  readonly count: number;
  readonly results: readonly T[];
  readonly next: string | null;
}
