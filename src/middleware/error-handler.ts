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
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: process.env.NODE_ENV === 'development'
              ? (error as Error).message
              : 'An internal error occurred',
          },
        }),
      };
    },
  };
}
