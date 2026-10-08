export interface MarketplaceBlueprintPackage {
  id: string;
  name: string;
  version: string;
  author: string;
  category: 'crm' | 'project' | 'inventory' | 'finance' | 'hr' | 'ecommerce' | 'custom';
  description: string;
  tags: string[];
  rating: number; // e.g. 4.9
  deploymentsCount: number;
  isVerified?: boolean;
  blueprint: {
    collections: any[];
    menus: any[];
    workflows: any[];
    proactiveAgents?: any[];
  };
  previewImages?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceFilter {
  category?: string;
  query?: string;
  tag?: string;
  verifiedOnly?: boolean;
  sortBy?: 'popular' | 'rating' | 'latest';
}

export interface DeploymentOptions {
  targetAppId: string;
  targetAppTitle?: string;
  seedMockData?: boolean;
  autoDeployAgents?: boolean;
  tenantId?: string;
}

export interface DeploymentResult {
  deploymentId: string;
  blueprintId: string;
  targetAppId: string;
  createdCollections: string[];
  createdPages: string[];
  createdWorkflows: string[];
  deployedAgents: string[];
  timestamp: Date;
  status: 'success' | 'failed';
  error?: string;
}
