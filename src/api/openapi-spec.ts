/**
 * OpenAPI 3.1 specification for the Neuron REST API.
 *
 * Hand-written spec object served at GET /openapi.json.
 */

export type OpenapiSpec = typeof openapiSpec

export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Neuron REST API',
    version: '1.0.0',
    description: 'Third-party access to Neuron operational data',
  },
  servers: [{ url: '/v1' }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey' as const,
        in: 'header' as const,
        name: 'X-API-Key',
      },
    },
    schemas: {
      Error: {
        type: 'object' as const,
        properties: {
          error: { type: 'string' as const },
        },
        required: ['error'],
      },
      Organization: {
        type: 'object' as const,
        properties: {
          npi: { type: 'string' as const, description: 'Organization NPI' },
          name: { type: 'string' as const, description: 'Organization name' },
          type: { type: 'string' as const, description: 'Organization type' },
          axon_status: { type: 'string' as const, description: 'Axon registration status' },
          providers: { type: 'integer' as const, description: 'Number of registered providers' },
        },
        required: ['npi', 'name', 'type', 'axon_status', 'providers'],
      },
      Relationship: {
        type: 'object' as const,
        properties: {
          relationship_id: { type: 'string' as const, format: 'uuid' },
          patient_agent_id: { type: 'string' as const },
          provider_npi: { type: 'string' as const },
          status: {
            type: 'string' as const,
            enum: ['pending', 'active', 'suspended', 'terminated'],
          },
          consented_actions: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
          created_at: { type: 'string' as const, format: 'date-time' },
          updated_at: { type: 'string' as const, format: 'date-time' },
        },
        required: [
          'relationship_id',
          'patient_agent_id',
          'provider_npi',
          'status',
          'consented_actions',
          'created_at',
          'updated_at',
        ],
      },
      RelationshipList: {
        type: 'object' as const,
        properties: {
          data: {
            type: 'array' as const,
            items: { $ref: '#/components/schemas/Relationship' },
          },
          total: { type: 'integer' as const },
          offset: { type: 'integer' as const },
          limit: { type: 'integer' as const },
        },
        required: ['data', 'total', 'offset', 'limit'],
      },
      Status: {
        type: 'object' as const,
        properties: {
          status: { type: 'string' as const },
          uptime_seconds: { type: 'integer' as const },
          organization: {
            type: 'object' as const,
            properties: {
              npi: { type: 'string' as const },
              name: { type: 'string' as const },
            },
            required: ['npi', 'name'],
          },
          axon: {
            type: 'object' as const,
            properties: {
              status: { type: 'string' as const },
            },
            required: ['status'],
          },
          active_sessions: { type: 'integer' as const },
          providers: { type: 'integer' as const },
        },
        required: [
          'status',
          'uptime_seconds',
          'organization',
          'axon',
          'active_sessions',
          'providers',
        ],
      },
    },
  },
  paths: {
    '/organization': {
      get: {
        summary: 'Get organization info',
        description: 'Returns the organization name, NPI, type, Axon registration status, and provider count.',
        operationId: 'getOrganization',
        responses: {
          '200': {
            description: 'Organization info',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Organization' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/relationships': {
      get: {
        summary: 'List relationships',
        description: 'Returns a paginated list of relationships with optional status or provider NPI filtering.',
        operationId: 'listRelationships',
        parameters: [
          {
            name: 'status',
            in: 'query' as const,
            schema: { type: 'string' as const },
            description: 'Filter by relationship status',
          },
          {
            name: 'provider_npi',
            in: 'query' as const,
            schema: { type: 'string' as const },
            description: 'Filter by provider NPI',
          },
          {
            name: 'offset',
            in: 'query' as const,
            schema: { type: 'integer' as const, default: 0 },
            description: 'Pagination offset',
          },
          {
            name: 'limit',
            in: 'query' as const,
            schema: { type: 'integer' as const, default: 50, maximum: 100 },
            description: 'Pagination limit (max 100)',
          },
        ],
        responses: {
          '200': {
            description: 'Paginated relationship list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RelationshipList' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/relationships/{id}': {
      get: {
        summary: 'Get relationship by ID',
        description: 'Returns a single relationship record.',
        operationId: 'getRelationship',
        parameters: [
          {
            name: 'id',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const, format: 'uuid' },
            description: 'Relationship ID',
          },
        ],
        responses: {
          '200': {
            description: 'Relationship record',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Relationship' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '404': {
            description: 'Relationship not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/status': {
      get: {
        summary: 'Get server status',
        description:
          'Returns Neuron operational status including uptime, Axon registration, active sessions, and provider count.',
        operationId: 'getStatus',
        responses: {
          '200': {
            description: 'Server status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Status' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
  },
}
