import React from "react";
import { useState, useEffect, useCallback } from "react";
import { bookingClient } from "../../lib/bookingClient";
import type { TimeSlot } from "../../types/booking";

type LocalState = {
  version: number;
  slots: TimeSlot[];
  // 本地临时状态："locking"/"confirming" 用于乐观 UI
  transient: Record<string, "locking" | "confirming">;
  // 我方拥有的锁：slotId -> lockId
  myLocks: Record<string, string>;
  // 我方已成功预约的时段
  myBooked: Record<string, true>;
  userId: string;
  message?: string;
};

export function TimeSlotGrid(): JSX.Element {
  const [state, setState] = useState<LocalState>(() => ({
    version: 0,
    slots: [],
    transient: {},
    myLocks: {},
    myBooked: {},
    userId: `u_${Math.random().toString(36).slice(2, 8)}`,
  }));
  const [cols, setCols] = useState<number>(1);

  // 响应式列数（移动端优先）
  useEffect(() => {
    const compute = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : 375;
      // iPhone 16/16 Pro 等新机型的逻辑像素宽度约在 390~430 区间（横向窄边）
      // 需求：在该区间内每行显示 4 个
      if (w >= 380 && w <= 460) return 4;
      if (w < 480) return 1;
      if (w < 768) return 2;
      return 3;
    };
    const apply = () => setCols(compute());
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // 初始加载
  useEffect(() => {
    let mounted = true;
    bookingClient.listSlots({}).then((res) => {
      if (!mounted) return;
      setState((s) => ({ ...s, slots: res.slots, version: res.version }));
    });
    // 订阅更新
    const unsub = bookingClient.subscribe((evt) => {
      setState((s) => {
        // 只接受比当前版本新的状态
        if (evt.version <= s.version) return s;
        // 合并：保持本地 transient，但以服务端为真实来源
        return { ...s, slots: evt.slots, version: evt.version };
      });
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const onClickAvailable = useCallback(
    async (slotId: string) => {
      if (state.transient[slotId]) return;
      if (state.myBooked[slotId]) return; // 已预约则不再重复预约
      // 第一步：尝试锁定
      setState((s) => ({
        ...s,
        transient: { ...s.transient, [slotId]: "locking" },
        message: undefined,
      }));

      const currentVersion = state.version;
      const userId = state.userId;
      const lockRes = await bookingClient.lockSlot({
        slotId,
        userId,
        expectedVersion: currentVersion,
      });

      if (!lockRes.ok || !lockRes.lock) {
        setState((s) => ({
          ...s,
          transient: omitKey(s.transient, slotId),
          message:
            lockRes.error === "LockedByOther"
              ? `该时段刚被其他人锁定`
              : lockRes.error === "AlreadyBooked"
              ? `该时段已被预定`
              : `锁定失败: ${lockRes.error ?? "Unknown"}`,
          version: lockRes.version ?? s.version,
        }));
        return;
      }

      // 第二步：立即确认预定
      setState((s) => ({
        ...s,
        myLocks: { ...s.myLocks, [slotId]: lockRes.lock!.lockId },
        transient: { ...s.transient, [slotId]: "confirming" },
        version: lockRes.version,
        message: `预定中：${
          s.slots.find((x) => x.id === slotId)?.label ?? slotId
        }`,
      }));

      const confirmRes = await bookingClient.confirmBooking({
        lockId: lockRes.lock.lockId,
        userId,
      });

      if (!confirmRes.ok) {
        setState((s) => ({
          ...s,
          myLocks: omitKey(s.myLocks, slotId),
          transient: omitKey(s.transient, slotId),
          message:
            confirmRes.error === "LockExpired"
              ? `锁已过期，请重试`
              : `预定失败: ${confirmRes.error ?? "Unknown"}`,
          version: confirmRes.version ?? s.version,
        }));
        return;
      }

      setState((s) => ({
        ...s,
        transient: omitKey(s.transient, slotId),
        myLocks: omitKey(s.myLocks, slotId),
        myBooked: { ...s.myBooked, [slotId]: true },
        version: confirmRes.version,
        message: `预定成功：${
          s.slots.find((x) => x.id === slotId)?.label ?? slotId
        }`,
      }));
    },
    [state.version, state.userId, state.transient]
  );

  const onConfirm = useCallback(
    async (slotId: string) => {
      const lockId = state.myLocks[slotId];
      if (!lockId) return;

      // 乐观：标记 confirming
      setState((s) => ({
        ...s,
        transient: { ...s.transient, [slotId]: "confirming" },
        message: undefined,
      }));

      const res = await bookingClient.confirmBooking({
        lockId,
        userId: state.userId,
      });
      if (!res.ok) {
        // 回滚：删除本地锁引用 & 清理transient
        setState((s) => ({
          ...s,
          myLocks: omitKey(s.myLocks, slotId),
          transient: omitKey(s.transient, slotId),
          message:
            res.error === "LockExpired"
              ? `锁已过期，请重试`
              : `确认失败: ${res.error ?? "Unknown"}`,
          version: res.version ?? s.version,
        }));
        return;
      }

      // 成功：服务端会广播最新状态；我们仍同步 version 并清理 transient
      setState((s) => ({
        ...s,
        transient: omitKey(s.transient, slotId),
        myLocks: omitKey(s.myLocks, slotId),
        version: res.version,
        message: `预定成功：${slotId}`,
      }));
    },
    [state.myLocks, state.userId]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          height: 24,
          minHeight: 24,
          display: "flex",
          alignItems: "center",
        }}
      >
        <span
          role="status"
          style={{
            color: "#065f46",
            opacity: state.message ? 1 : 0,
            transition: "opacity 200ms ease",
          }}
        >
          {state.message || "\u00A0"}
        </span>
      </div>
      <div
        role="grid"
        aria-label="可预定时间段列表"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(${
            cols >= 4 ? 72 : 120
          }px, 1fr))`,
          gap: 8,
          justifyContent: "center",
          width: "100%",
          maxWidth: 360,
        }}
      >
        {state.slots.map((slot) => {
          const transient = state.transient[slot.id];
          const iOwnLock = !!state.myLocks[slot.id];
          const statusLabel = (() => {
            if (transient === "locking" || transient === "confirming")
              return "预定中...";
            if (state.myBooked[slot.id]) return "已预定"; // 我已预约
            if (slot.status === "booked") return "已预定"; // 全量占满
            if (slot.booked) return "已锁定";
            return `可用`;
          })();

          // 三态背景：可用(绿)、已锁定(灰)、已预定(红)。处理过渡态为黄。
          const bg = (() => {
            if (transient === "locking" || transient === "confirming")
              return "#fde68a"; // 过渡
            if (state.myBooked[slot.id] || slot.status === "booked")
              return "#fee2e2"; // 已预定
            if (slot.booked) return "#e5e7eb"; // 已锁定
            return "#ecfdf5"; // 可用
          })();

          return (
            <div
              key={slot.id}
              role="gridcell"
              aria-selected={
                slot.status === "booked" ||
                (slot.status === "locked" && iOwnLock)
                  ? true
                  : false
              }
              aria-busy={transient ? true : undefined}
              tabIndex={0}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 10,
                background: bg,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                height: 120,
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                if (slot.status === "available" && !transient) {
                  e.preventDefault();
                  onClickAvailable(slot.id);
                } else if (
                  slot.status === "locked" &&
                  iOwnLock &&
                  transient !== "confirming"
                ) {
                  e.preventDefault();
                  onConfirm(slot.id);
                }
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
                {slot.label}
              </div>
              <div style={{ fontSize: 12, color: "#1f2937", minHeight: 18 }}>
                {statusLabel}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  minHeight: 36,
                }}
              >
                {!state.myBooked[slot.id] &&
                slot.status !== "booked" &&
                !slot.booked &&
                !transient ? (
                  <button
                    onClick={() => onClickAvailable(slot.id)}
                    aria-label={`预定 ${slot.label}`}
                    style={{
                      background: "#0ea5e9",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: cols >= 4 ? "6px 10px" : "8px 12px",
                      cursor: "pointer",
                      minWidth: cols >= 4 ? 64 : 88,
                    }}
                  >
                    预定
                  </button>
                ) : null}
                {/* 无二次确认与取消按钮，锁定成功后即自动确认 */}
                {!state.myBooked[slot.id] &&
                slot.status !== "booked" &&
                slot.booked ? (
                  <button
                    disabled
                    aria-disabled
                    aria-label={`已锁定 ${slot.label}`}
                    style={{
                      background: "#9ca3af",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: cols >= 4 ? "6px 10px" : "8px 12px",
                      minWidth: cols >= 4 ? 64 : 88,
                    }}
                  >
                    已锁定
                  </button>
                ) : null}
                {slot.status === "booked" ? (
                  <button
                    disabled
                    aria-disabled
                    aria-label={`已预定 ${slot.id}`}
                    style={{
                      background: "#6b7280",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: cols >= 4 ? "6px 10px" : "8px 12px",
                      minWidth: cols >= 4 ? 64 : 88,
                    }}
                  >
                    已预定
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function omitKey<T extends Record<string, any>>(obj: T, key: string): T {
  const { [key]: _omit, ...rest } = obj;
  return rest as T;
}

export default TimeSlotGrid;
