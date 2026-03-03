export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: string;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
}

export interface ApiResponse<T = unknown> {
  data: T | null;
  meta: {
    request_id: string;
    timestamp: string;
    pagination?: PaginationMeta;
  };
  errors: ApiError[];
}

export interface RouteHandler {
  (event: LambdaEvent): Promise<LambdaResult>;
}

export interface LambdaEvent {
  rawPath: string;
  requestContext: {
    http: {
      method: string;
      path: string;
    };
  };
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface LambdaResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
