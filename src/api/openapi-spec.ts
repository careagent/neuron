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
      Health: {
        type: 'object' as const,
        properties: {
          status: { type: 'string' as const, enum: ['ok'] },
          timestamp: { type: 'string' as const, format: 'date-time' },
          uptime_seconds: { type: 'integer' as const },
        },
        required: ['status', 'timestamp', 'uptime_seconds'],
      },
      ProviderRegistration: {
        type: 'object' as const,
        properties: {
          provider_npi: { type: 'string' as const, pattern: '^\\d{10}$' },
          provider_name: { type: 'string' as const },
          provider_types: { type: 'array' as const, items: { type: 'string' as const } },
          specialty: { type: 'string' as const },
          registration_status: { type: 'string' as const, enum: ['pending', 'registered', 'failed'] },
          axon_provider_id: { type: 'string' as const },
          first_registered_at: { type: 'string' as const, format: 'date-time' },
        },
        required: ['provider_npi', 'registration_status'],
      },
      RegistrationList: {
        type: 'object' as const,
        properties: {
          neuron: {
            type: 'object' as const,
            properties: {
              organization_npi: { type: 'string' as const },
              organization_name: { type: 'string' as const },
              organization_type: { type: 'string' as const },
              status: { type: 'string' as const },
              registration_id: { type: 'string' as const },
              first_registered_at: { type: 'string' as const },
            },
            nullable: true,
          },
          providers: {
            type: 'array' as const,
            items: { $ref: '#/components/schemas/ProviderRegistration' },
          },
          total_providers: { type: 'integer' as const },
        },
        required: ['providers', 'total_providers'],
      },
      ConsentStatus: {
        type: 'object' as const,
        properties: {
          relationship_id: { type: 'string' as const },
          status: { type: 'string' as const },
          patient_agent_id: { type: 'string' as const },
          provider_npi: { type: 'string' as const },
          consented_actions: { type: 'array' as const, items: { type: 'string' as const } },
          created_at: { type: 'string' as const },
          updated_at: { type: 'string' as const },
        },
        required: ['relationship_id', 'status'],
      },
      CreateRegistrationRequest: {
        type: 'object' as const,
        properties: {
          provider_npi: { type: 'string' as const, pattern: '^\\d{10}$' },
          provider_name: { type: 'string' as const, minLength: 1 },
          provider_types: { type: 'array' as const, items: { type: 'string' as const }, minItems: 1 },
          specialty: { type: 'string' as const },
        },
        required: ['provider_npi', 'provider_name', 'provider_types'],
      },
      InjectaVoxPayload: {
        type: 'object' as const,
        properties: {
          visit_id: { type: 'string' as const, format: 'uuid' },
          provider_npi: { type: 'string' as const, pattern: '^\\d{10}$' },
          patient_id: { type: 'string' as const },
          visit_type: { type: 'string' as const, enum: ['in_person', 'telehealth', 'follow_up'] },
          visit_date: { type: 'string' as const, format: 'date-time' },
          chief_complaint: { type: 'string' as const },
          clinical_notes: { type: 'string' as const },
          vitals: {
            type: 'object' as const,
            properties: {
              blood_pressure: { type: 'string' as const },
              heart_rate: { type: 'number' as const },
              temperature: { type: 'number' as const },
              weight: { type: 'number' as const },
              height: { type: 'number' as const },
            },
          },
          assessment: { type: 'string' as const },
          plan: { type: 'string' as const },
          medications: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                name: { type: 'string' as const },
                dosage: { type: 'string' as const },
                frequency: { type: 'string' as const },
                route: { type: 'string' as const },
              },
              required: ['name', 'dosage', 'frequency', 'route'],
            },
          },
          follow_up: {
            type: 'object' as const,
            properties: {
              date: { type: 'string' as const, format: 'date-time' },
              instructions: { type: 'string' as const },
            },
            required: ['date', 'instructions'],
          },
        },
        required: [
          'visit_id', 'provider_npi', 'patient_id', 'visit_type',
          'visit_date', 'chief_complaint', 'clinical_notes',
          'assessment', 'plan',
        ],
      },
      InjectaVoxIngestResult: {
        type: 'object' as const,
        properties: {
          visit_id: { type: 'string' as const },
          provider_npi: { type: 'string' as const },
          patient_id: { type: 'string' as const },
          ingested_at: { type: 'string' as const, format: 'date-time' },
          status: { type: 'string' as const, enum: ['ingested'] },
        },
        required: ['visit_id', 'provider_npi', 'patient_id', 'ingested_at', 'status'],
      },
      InjectaVoxVisitList: {
        type: 'object' as const,
        properties: {
          data: { type: 'array' as const, items: { $ref: '#/components/schemas/InjectaVoxPayload' } },
          total: { type: 'integer' as const },
          limit: { type: 'integer' as const },
          offset: { type: 'integer' as const },
        },
        required: ['data', 'total', 'limit', 'offset'],
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns basic liveness information. No authentication required.',
        operationId: 'healthCheck',
        security: [],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
              },
            },
          },
        },
      },
    },
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
    '/registrations': {
      get: {
        summary: 'List registered entities',
        description: 'Returns the neuron registration state and all registered providers.',
        operationId: 'listRegistrations',
        responses: {
          '200': {
            description: 'Registration list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegistrationList' },
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
      post: {
        summary: 'Register a new provider',
        description: 'Registers a new provider with Axon and persists to state.',
        operationId: 'createRegistration',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateRegistrationRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Provider registered',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProviderRegistration' },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
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
    '/registrations/{id}': {
      get: {
        summary: 'Get specific registration',
        description: 'Returns a single provider registration by NPI.',
        operationId: 'getRegistration',
        parameters: [
          {
            name: 'id',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
            description: 'Provider NPI',
          },
        ],
        responses: {
          '200': {
            description: 'Provider registration',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProviderRegistration' },
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
            description: 'Registration not found',
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
    '/consent/status/{relationship_id}': {
      get: {
        summary: 'Get consent relationship status',
        description: 'Returns the consent status for a specific relationship.',
        operationId: 'getConsentStatus',
        parameters: [
          {
            name: 'relationship_id',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
            description: 'Relationship ID',
          },
        ],
        responses: {
          '200': {
            description: 'Consent status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ConsentStatus' },
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
    '/injectavox/ingest': {
      post: {
        summary: 'Ingest clinical visit data',
        description: 'InjectaVox pushes clinical visit data (notes, summaries, vitals) for provider agent consumption.',
        operationId: 'injectaVoxIngest',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InjectaVoxPayload' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Visit ingested',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InjectaVoxIngestResult' },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
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
          '409': {
            description: 'Duplicate visit_id',
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
    '/injectavox/visits/{provider_npi}': {
      get: {
        summary: 'List unprocessed visits for provider',
        description: 'Returns unprocessed clinical visit data for a provider NPI.',
        operationId: 'listInjectaVoxVisits',
        parameters: [
          {
            name: 'provider_npi',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const, pattern: '^\\d{10}$' },
            description: '10-digit provider NPI',
          },
          {
            name: 'limit',
            in: 'query' as const,
            schema: { type: 'integer' as const, default: 50, maximum: 100 },
            description: 'Pagination limit (max 100)',
          },
          {
            name: 'offset',
            in: 'query' as const,
            schema: { type: 'integer' as const, default: 0 },
            description: 'Pagination offset',
          },
        ],
        responses: {
          '200': {
            description: 'Paginated visit list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InjectaVoxVisitList' },
              },
            },
          },
          '400': {
            description: 'Invalid NPI format',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
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
