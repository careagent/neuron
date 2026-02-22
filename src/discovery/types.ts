/** Configuration for the DiscoveryService */
export interface DiscoveryConfig {
  enabled: boolean
  serviceType: string
  protocolVersion: string
  organizationNpi: string
  serverPort: number
  endpointUrl: string
}
