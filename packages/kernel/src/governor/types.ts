export type GovernorTier = 'stable_0' | 'stable_3' | 'stable_6' | 'stable_8' | 'stable_12' | 'stable_16';

export interface GovernorConfig {
  initialTier: GovernorTier;
  promotionWindowHours: number;
  demotionFailureThreshold: number;
}

export const DEFAULT_GOV_CONFIG: GovernorConfig = {
  initialTier: 'stable_3',
  promotionWindowHours: 48,
  demotionFailureThreshold: 0.3,
};

export interface GovernorState {
  currentTier: GovernorTier;
  maxWorkers: number;
  activeWorkers: number;
  queuedWorkers: number;
  tierHistory: Array<{ tier: GovernorTier; startedAt: string; reason: string }>;
  cleanOperationStartedAt: string;
  lastPromotionAt: string | null;
  lastDemotionAt: string | null;
}

export const TIER_LIMITS: Record<GovernorTier, number> = {
  'stable_0': 0,
  'stable_3': 3,
  'stable_6': 6,
  'stable_8': 8,
  'stable_12': 12,
  'stable_16': 16,
};

export const TIER_ORDER: GovernorTier[] = ['stable_0', 'stable_3', 'stable_6', 'stable_8', 'stable_12', 'stable_16'];
