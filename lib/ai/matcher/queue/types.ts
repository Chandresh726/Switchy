export interface QueueStatus {
  isEnabled: boolean;
  pending: number;
  size: number;
  position: number;
}

export type QueuePositionCallback = (position: number) => void;
