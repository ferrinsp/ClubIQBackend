import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { dispatch } from './router.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const result = await dispatch(event as any);
  return result;
}

export const handler = middy(baseHandler).use(errorHandlerMiddleware());
