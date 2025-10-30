export type SlotId = string;

export type SlotStatus =
  | "available"
  | "locked"
  | "booked";

export interface TimeSlot {
  id: SlotId;
  status: SlotStatus;
  // 新增：用于显示的时间段标签，例如 "10:00-11:00"
  label: string;
  // 新增：剩余可预约数量
  remaining: number;
  // 可选：锁拥有者，用于诊断/演示；真实后端可不返回
  lockedBy?: string;
  // 已预定者，演示用途
  bookedBy?: string;
}

// —— API 协议（前端声明）——

// 1) 获取时间段列表
export interface ListSlotsRequest {
  afterVersion?: number; // 可选：基于版本的增量同步
}
export interface ListSlotsResponse {
  slots: TimeSlot[];
  version: number; // 逻辑时钟/版本号，便于前端幂等与同步
}

// 2) 尝试锁定某一时间段
export interface LockSlotRequest {
  slotId: SlotId;
  userId: string; // 前端生成或来自会话
  // 可选：期望版本，用于条件更新，防止写偏差
  expectedVersion?: number;
}
export interface LockSlotResponse {
  ok: boolean;
  lock?: {
    lockId: string;
    slotId: SlotId;
    expiresAt: number; // 服务器时间戳(ms)
  };
  version: number;
  error?: "AlreadyBooked" | "LockedByOther" | "NotFound" | "VersionConflict";
}

// 3) 确认预定（需携带有效锁）
export interface ConfirmBookingRequest {
  lockId: string;
  userId: string;
}
export interface ConfirmBookingResponse {
  ok: boolean;
  slot?: TimeSlot;
  version: number;
  error?: "LockExpired" | "LockNotFound" | "AlreadyBooked" | "NotFound";
}

// 4) 释放锁（主动取消）
export interface ReleaseLockRequest {
  lockId: string;
  userId: string;
}
export interface ReleaseLockResponse {
  ok: boolean;
  version: number;
  error?: "LockNotFound" | "Forbidden";
}

// 5) 订阅/轮询更新（这里用前端模拟，真实可用SSE/WebSocket）
export type SlotsUpdateEvent = {
  type: "slots:update";
  slots: TimeSlot[];
  version: number;
};


