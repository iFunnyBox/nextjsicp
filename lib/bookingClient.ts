import type {
  ConfirmBookingRequest,
  ConfirmBookingResponse,
  ListSlotsRequest,
  ListSlotsResponse,
  LockSlotRequest,
  LockSlotResponse,
  ReleaseLockRequest,
  ReleaseLockResponse,
  SlotId,
  TimeSlot,
  SlotsUpdateEvent,
} from "../types/booking";

// 这是一个前端内存中的 MockServer，用于演示并发冲突与状态同步
// 真实项目中可替换为实际 HTTP/SSE/WebSocket 实现

type LockRecord = {
  lockId: string;
  slotId: SlotId;
  userId: string;
  expiresAt: number; // ms
};

class MockServer {
  private slots: Map<SlotId, TimeSlot> = new Map();
  private locks: Map<string, LockRecord> = new Map();
  private version = 1;
  private subscribers = new Set<(evt: SlotsUpdateEvent) => void>();

  constructor() {
    // 初始化一些连续且不冲突的时间段（例如 10:00-11:00 起，12 个小时段）
    const startHour = 10;
    const initial: TimeSlot[] = Array.from({ length: Math.floor(Math.random() * 5) + 5 }).map((_, i) => {
      const from = startHour + i;
      const to = from + 1;
      const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;
      const label = `${fmt(from)}-${fmt(to)}`;
      const locked = Math.random() < 0.4; // 约 40% 直接为锁定
      return {
        id: `slot-${i + 1}`,
        label,
        status: "available",
        booked: locked,
      } as TimeSlot;
    });
    initial.forEach((s) => this.slots.set(s.id, s));

    // 定时清理过期锁
    setInterval(() => this.gcExpiredLocks(), 1000);
  }

  private bumpVersionAndBroadcast() {
    this.version += 1;
    const slots = Array.from(this.slots.values());
    const evt: SlotsUpdateEvent = {
      type: "slots:update",
      slots,
      version: this.version,
    };
    this.subscribers.forEach((fn) => fn(evt));
  }

  private gcExpiredLocks() {
    const now = Date.now();
    let changed = false;
    const expiredLockIds: string[] = [];
    this.locks.forEach((rec, lockId) => {
      if (rec.expiresAt <= now) {
        expiredLockIds.push(lockId);
        const slot = this.slots.get(rec.slotId);
        if (slot && slot.status === "locked") {
          slot.status = "available";
          slot.lockedBy = undefined;
          changed = true;
        }
      }
    });
    // 单独删除以避免在遍历时修改 Map
    expiredLockIds.forEach((lockId) => this.locks.delete(lockId));
    if (changed) this.bumpVersionAndBroadcast();
  }

  subscribe(cb: (evt: SlotsUpdateEvent) => void) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async listSlots(_req: ListSlotsRequest): Promise<ListSlotsResponse> {
    // 模拟网络延迟
    await delay(100);
    return {
      slots: Array.from(this.slots.values()),
      version: this.version,
    };
  }

  async lockSlot(req: LockSlotRequest): Promise<LockSlotResponse> {
    await delay(150);
    const slot = this.slots.get(req.slotId);
    if (!slot) {
      return { ok: false, version: this.version, error: "NotFound" };
    }
    // 版本检测（可选）
    if (req.expectedVersion && req.expectedVersion !== this.version) {
      return { ok: false, version: this.version, error: "VersionConflict" };
    }

    if (slot.status === "booked") {
      return { ok: false, version: this.version, error: "AlreadyBooked" };
    }
    if (slot.booked) {
      return { ok: false, version: this.version, error: "AlreadyBooked" };
    }
    if (slot.status === "locked" && slot.lockedBy !== req.userId) {
      return { ok: false, version: this.version, error: "LockedByOther" };
    }

    // 生成锁
    const lockId = `lock_${Math.random().toString(36).slice(2)}`;
    const lock: LockRecord = {
      lockId,
      slotId: slot.id,
      userId: req.userId,
      expiresAt: Date.now() + 10_000, // 10s 过期
    };
    this.locks.set(lockId, lock);
    slot.status = "locked";
    slot.lockedBy = req.userId;
    this.bumpVersionAndBroadcast();
    return {
      ok: true,
      lock: { lockId, slotId: slot.id, expiresAt: lock.expiresAt },
      version: this.version,
    };
  }

  async confirmBooking(
    req: ConfirmBookingRequest
  ): Promise<ConfirmBookingResponse> {
    await delay(200);
    const rec = this.locks.get(req.lockId);
    if (!rec)
      return { ok: false, version: this.version, error: "LockNotFound" };
    if (rec.userId !== req.userId)
      return { ok: false, version: this.version, error: "LockNotFound" };
    if (rec.expiresAt <= Date.now())
      return { ok: false, version: this.version, error: "LockExpired" };

    const slot = this.slots.get(rec.slotId);
    if (!slot) return { ok: false, version: this.version, error: "NotFound" };
    if (slot.status === "booked")
      return { ok: false, version: this.version, error: "AlreadyBooked" };
    if (slot.booked)
      return { ok: false, version: this.version, error: "AlreadyBooked" };

    slot.booked = false;
    // 释放锁并恢复为可锁定态（UI 将基于 remaining 展示 可用/已锁定）
    slot.lockedBy = undefined;
    slot.status = "available";
    this.locks.delete(req.lockId);
    this.bumpVersionAndBroadcast();
    return { ok: true, slot, version: this.version };
  }

  async releaseLock(req: ReleaseLockRequest): Promise<ReleaseLockResponse> {
    await delay(120);
    const rec = this.locks.get(req.lockId);
    if (!rec)
      return { ok: false, version: this.version, error: "LockNotFound" };
    if (rec.userId !== req.userId)
      return { ok: false, version: this.version, error: "Forbidden" };

    const slot = this.slots.get(rec.slotId);
    this.locks.delete(req.lockId);
    if (slot && slot.status === "locked") {
      slot.status = "available";
      slot.lockedBy = undefined;
    }
    this.bumpVersionAndBroadcast();
    return { ok: true, version: this.version };
  }
}

const server = new MockServer();

export const bookingClient = {
  listSlots: (req: ListSlotsRequest = {}) => server.listSlots(req),
  lockSlot: (req: LockSlotRequest) => server.lockSlot(req),
  confirmBooking: (req: ConfirmBookingRequest) => server.confirmBooking(req),
  releaseLock: (req: ReleaseLockRequest) => server.releaseLock(req),
  subscribe: (cb: (evt: SlotsUpdateEvent) => void) => server.subscribe(cb),
};

// 简单延迟工具
function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
