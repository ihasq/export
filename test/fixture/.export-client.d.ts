// Auto-generated client type definitions. Do not edit manually.

/** D1 query result from tagged template literal */
export interface ExportD1Query<T = Record<string, unknown>> {
  /** Execute query and return all results */
  all(): Promise<{ results: T[]; success: boolean; meta: object }>;
  /** Execute query and return first result */
  first<K extends keyof T>(colName?: K): Promise<K extends keyof T ? T[K] : T | null>;
  /** Execute query without returning results */
  run(): Promise<{ success: boolean; meta: object }>;
  /** Execute query and return raw array results */
  raw<K extends keyof T = keyof T>(): Promise<K extends keyof T ? T[K][] : unknown[][]>;
  /** Thenable - defaults to .all() */
  then<TResult = { results: T[]; success: boolean; meta: object }>(
    onfulfilled?: (value: { results: T[]; success: boolean; meta: object }) => TResult | PromiseLike<TResult>,
    onrejected?: (reason: any) => TResult | PromiseLike<TResult>
  ): Promise<TResult>;
}

/** D1 database proxy - use as tagged template literal */
export interface ExportD1Proxy {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): ExportD1Query<T>;
}

/** R2 object metadata */
export interface ExportR2ObjectMeta {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

/** R2 object with body */
export interface ExportR2Object extends ExportR2ObjectMeta {
  body: ReadableStream<Uint8Array>;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
}

/** R2 list result */
export interface ExportR2ListResult {
  objects: ExportR2ObjectMeta[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

/** R2 bucket proxy */
export interface ExportR2Proxy {
  get(key: string, options?: { type?: "arrayBuffer" | "text" | "json" | "stream" }): Promise<ExportR2Object | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream | Blob, options?: {
    httpMetadata?: Record<string, string>;
    customMetadata?: Record<string, string>;
  }): Promise<ExportR2ObjectMeta>;
  delete(key: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
    include?: ("httpMetadata" | "customMetadata")[];
  }): Promise<ExportR2ListResult>;
  head(key: string): Promise<ExportR2ObjectMeta | null>;
}

/** KV list result */
export interface ExportKVListResult {
  keys: { name: string; expiration?: number; metadata?: unknown }[];
  list_complete: boolean;
  cursor?: string;
}

/** KV namespace proxy */
export interface ExportKVProxy {
  get<T = string>(key: string, options?: { type?: "text" | "json" | "arrayBuffer" | "stream"; cacheTtl?: number }): Promise<T | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: {
    expiration?: number;
    expirationTtl?: number;
    metadata?: unknown;
  }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ExportKVListResult>;
  getWithMetadata<T = string, M = unknown>(key: string, options?: { type?: "text" | "json" | "arrayBuffer" | "stream"; cacheTtl?: number }): Promise<{
    value: T | null;
    metadata: M | null;
  }>;
}

/** Auth sign-in methods */
export interface ExportAuthSignIn {
  /** Sign in with OAuth provider */
  social(provider: string, options?: { callbackURL?: string; scopes?: string[] }): Promise<{ redirectUrl?: string; token?: string; user?: object }>;
  /** Sign in with email and password */
  email(email: string, password: string, options?: object): Promise<{ success: boolean; token?: string; user?: object; error?: string }>;
}

/** Auth sign-up methods */
export interface ExportAuthSignUp {
  /** Sign up with email, password, and name */
  email(email: string, password: string, name?: string, options?: object): Promise<{ success: boolean; token?: string; user?: object; error?: string }>;
}

/** Auth session */
export interface ExportAuthSession {
  token: string;
  userId: string;
  expiresAt: Date;
}

/** Auth user */
export interface ExportAuthUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Auth client proxy */
export interface ExportAuthProxy {
  signIn: ExportAuthSignIn;
  signUp: ExportAuthSignUp;
  signOut(): Promise<{ success: boolean }>;
  getSession(): Promise<ExportAuthSession | null>;
  getUser(): Promise<ExportAuthUser | null>;
  setToken(token: string): Promise<{ success: boolean }>;
  readonly isAuthenticated: boolean;
}

export interface ExportD1Bindings {}

export interface ExportR2Bindings {}

export interface ExportKVBindings {}

/** Export client with typed storage bindings */
export interface ExportClient {
  d1: ExportD1Bindings;
  r2: ExportR2Bindings;
  kv: ExportKVBindings;
  auth: null;
}

declare const client: ExportClient;
export default client;
