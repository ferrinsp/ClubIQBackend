export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
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
