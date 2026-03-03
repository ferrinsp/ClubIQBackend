import crypto from 'node:crypto';
import type middy from '@middy/core';

export function errorHandlerMiddleware(): middy.MiddlewareObj {
  return {
    onError: async (request) => {
      const error = request.error;
      console.error('Unhandled error:', error);

      request.response = {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          data: null,
          meta: {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          },
          errors: [{
            code: 'INTERNAL_ERROR',
            message: process.env.NODE_ENV === 'development'
              ? (error as Error).message
              : 'An internal error occurred',
          }],
        }),
      };
    },
  };
}
